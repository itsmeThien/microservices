import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { pool } from './db.js';
import { startOutboxWorker, processOutbox } from './outboxPublisher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORDER_PROTO_PATH = process.env.ORDER_PROTO_PATH || path.resolve(__dirname, '../../protos/order.proto');
const CUSTOMER_PROTO_PATH = process.env.CUSTOMER_PROTO_PATH || path.resolve(__dirname, '../../protos/customer.proto');
const PRODUCT_PROTO_PATH = process.env.PRODUCT_PROTO_PATH || path.resolve(__dirname, '../../protos/product.proto');

const PORT = process.env.PORT || '50054';
const CUSTOMER_SERVICE_URL = process.env.CUSTOMER_SERVICE_URL || 'customer-service:50052';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'product-service:50053';

// Load Protos
const orderPkgDef = protoLoader.loadSync(ORDER_PROTO_PATH, { keepCase: true, longs: String, defaults: true, oneofs: true });
const customerPkgDef = protoLoader.loadSync(CUSTOMER_PROTO_PATH, { keepCase: true, longs: String, defaults: true, oneofs: true });
const productPkgDef = protoLoader.loadSync(PRODUCT_PROTO_PATH, { keepCase: true, longs: String, defaults: true, oneofs: true });

const orderProto = grpc.loadPackageDefinition(orderPkgDef).order;
const customerProto = grpc.loadPackageDefinition(customerPkgDef).customer;
const productProto = grpc.loadPackageDefinition(productPkgDef).product;

// gRPC Clients for downstream synchronous calls
const customerClient = new customerProto.CustomerService(
  CUSTOMER_SERVICE_URL,
  grpc.credentials.createInsecure()
);

const productClient = new productProto.ProductService(
  PRODUCT_SERVICE_URL,
  grpc.credentials.createInsecure()
);

// Helper: Wrap gRPC client call in Promise
function callGrpc(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

// Calculate discount amount based on customer membership score
function calculateDiscount(score, subtotal) {
  let discountPercentage = 0;
  if (score >= 500) {
    discountPercentage = 20; // 20%
  } else if (score >= 200) {
    discountPercentage = 15; // 15%
  } else if (score >= 100) {
    discountPercentage = 10; // 10%
  } else if (score >= 50) {
    discountPercentage = 5;  // 5%
  }

  const discountAmount = (subtotal * discountPercentage) / 100;
  return {
    percentage: discountPercentage,
    amount: parseFloat(discountAmount.toFixed(2))
  };
}

// RPC: CreateOrder
async function createOrder(call, callback) {
  const { uid, items } = call.request;

  if (!uid || !items || items.length === 0) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'Invalid order request: uid and non-empty items are required'
    });
  }

  try {
    // 1. Get Customer & Membership Score via gRPC (synchronous)
    let customerScore = 0;
    try {
      const customer = await callGrpc(customerClient, 'getCustomer', { uid });
      customerScore = customer.score || 0;
      console.log(`[Order Service] Customer uid ${uid} found with score: ${customerScore}`);
    } catch (custErr) {
      console.warn(`[Order Service] Could not fetch customer info for uid ${uid}: ${custErr.message}`);
      // As per spec TC-ORD-01: if customer doesn't exist yet, we still allow order with score 0
      customerScore = 0;
    }

    // 2. Check and Reserve Inventory via gRPC with Product Service (synchronous)
    const reserveReq = {
      items: items.map((i) => ({ pid: i.pid, qty: i.qty }))
    };

    let reserveRes;
    try {
      reserveRes = await callGrpc(productClient, 'checkAndReserveStock', reserveReq);
    } catch (prodErr) {
      console.error('[Order Service] Product service call failed:', prodErr);
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Product service is unavailable: ' + prodErr.message
      });
    }

    if (!reserveRes.success) {
      console.warn(`[Order Service] Stock reservation failed: ${reserveRes.message}`);
      return callback({
        code: grpc.status.FAILED_PRECONDITION, // maps to HTTP 409 Conflict / stock error
        message: reserveRes.message
      });
    }

    const reservedItems = reserveRes.reserved_items;
    let subtotal = 0;
    for (const item of reservedItems) {
      subtotal += item.unit_price * item.qty;
    }

    // 3. Calculate discount based on score
    const discountInfo = calculateDiscount(customerScore, subtotal);
    const totalAmount = parseFloat(Math.max(0, subtotal - discountInfo.amount).toFixed(2));

    // 4. DB Transaction: Save Order + OrderDetail + OutboxEvent
    const client = await pool.connect();
    let orderRecord;

    try {
      await client.query('BEGIN');

      // Insert Order
      const orderInsertRes = await client.query(
        `INSERT INTO orders (uid, discount, total_amount, status)
         VALUES ($1, $2, $3, $4)
         RETURNING oid, uid, discount, total_amount, status, created_at`,
        [uid, discountInfo.amount, totalAmount, 'CREATED']
      );

      orderRecord = orderInsertRes.rows[0];
      const oid = orderRecord.oid;

      // Insert OrderDetails
      for (const item of reservedItems) {
        await client.query(
          `INSERT INTO order_details (oid, pid, qty, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [oid, item.pid, item.qty, item.unit_price]
        );
      }

      // Insert OutboxEvent (OrderCreated Event for Kafka)
      const outboxPayload = {
        eventId: `evt-${Date.now()}-${oid}`,
        oid,
        uid,
        discount: discountInfo.amount,
        total_amount: totalAmount,
        items: reservedItems.map((i) => ({
          pid: i.pid,
          pname: i.pname,
          qty: i.qty,
          unit_price: i.unit_price
        })),
        createdAt: new Date().toISOString()
      };

      await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
         VALUES ($1, $2, $3, $4, $5)`,
        ['ORDER', String(oid), 'OrderCreated', JSON.stringify(outboxPayload), 'PENDING']
      );

      await client.query('COMMIT');
      console.log(`[Order Service] Order ${oid} created successfully in DB with outbox event.`);
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('[Order Service] Transaction failed, rolled back:', txErr);
      throw txErr;
    } finally {
      client.release();
    }

    // Trigger Outbox publisher immediately (non-blocking)
    processOutbox().catch((err) => console.error('[Order Service] Immediate outbox publish trigger error:', err));

    return callback(null, {
      oid: orderRecord.oid,
      uid: orderRecord.uid,
      discount: parseFloat(orderRecord.discount),
      total_amount: parseFloat(orderRecord.total_amount),
      items: reservedItems.map((i) => ({
        pid: i.pid,
        qty: i.qty,
        unit_price: i.unit_price
      })),
      shipment: {
        shipid: orderRecord.oid,
        status: 'PENDING'
      }
    });
  } catch (err) {
    console.error('[Order Service] CreateOrder unexpected error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: GetOrders
async function getOrders(call, callback) {
  const { uid, role } = call.request;

  try {
    let query = 'SELECT oid, uid, discount, total_amount, status, created_at FROM orders';
    const params = [];

    if (role !== 'Admin') {
      query += ' WHERE uid = $1';
      params.push(uid);
    }
    query += ' ORDER BY oid DESC';

    const result = await pool.query(query, params);

    const items = result.rows.map((row) => ({
      oid: row.oid,
      uid: row.uid,
      discount: parseFloat(row.discount),
      total_amount: parseFloat(row.total_amount),
      status: row.status,
      created_at: row.created_at ? row.created_at.toISOString() : ''
    }));

    return callback(null, { items });
  } catch (err) {
    console.error('[Order Service] GetOrders error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: GetOrder
async function getOrder(call, callback) {
  const { oid, uid, role } = call.request;

  if (!oid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'oid is required'
    });
  }

  try {
    const orderRes = await pool.query('SELECT * FROM orders WHERE oid = $1', [oid]);
    if (orderRes.rows.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Order with oid ${oid} not found`
      });
    }

    const order = orderRes.rows[0];

    // Authorization: only the owner or Admin can view
    if (role !== 'Admin' && order.uid !== parseInt(uid, 10)) {
      return callback({
        code: grpc.status.PERMISSION_DENIED,
        message: 'Access denied: You are not authorized to view this order'
      });
    }

    const detailRes = await pool.query(
      'SELECT pid, qty, unit_price FROM order_details WHERE oid = $1',
      [oid]
    );

    const items = detailRes.rows.map((d) => ({
      pid: d.pid,
      qty: d.qty,
      unit_price: parseFloat(d.unit_price)
    }));

    return callback(null, {
      oid: order.oid,
      uid: order.uid,
      discount: parseFloat(order.discount),
      total_amount: parseFloat(order.total_amount),
      status: order.status,
      created_at: order.created_at ? order.created_at.toISOString() : '',
      items
    });
  } catch (err) {
    console.error('[Order Service] GetOrder error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

function startServer() {
  const server = new grpc.Server();
  server.addService(orderProto.OrderService.service, {
    createOrder,
    getOrders,
    getOrder
  });

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('[Order Service] Failed to bind port:', err);
        process.exit(1);
      }
      console.log(`[Order Service] gRPC server running at 0.0.0.0:${port}`);
      // Start Outbox publisher background worker
      startOutboxWorker(3000);
    }
  );
}

startServer();
