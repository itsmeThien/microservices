import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { connectDB } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../protos/product.proto');
const PORT = process.env.PORT || '50053';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const productProto = grpc.loadPackageDefinition(packageDefinition).product;

// RPC: GetProducts
async function getProducts(call, callback) {
  try {
    const db = await connectDB();
    const products = await db.collection('products').find({}).toArray();

    const items = products.map((p) => ({
      pid: p.pid,
      pname: p.pname,
      price: parseFloat(p.price),
      quantity: parseInt(p.quantity, 10)
    }));

    return callback(null, { items });
  } catch (err) {
    console.error('[Product Service] GetProducts error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: GetProduct
async function getProduct(call, callback) {
  const { pid } = call.request;

  if (!pid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'pid is required'
    });
  }

  try {
    const db = await connectDB();
    const product = await db.collection('products').findOne({ pid: parseInt(pid, 10) });

    if (!product) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Product with pid ${pid} not found`
      });
    }

    return callback(null, {
      pid: product.pid,
      pname: product.pname,
      price: parseFloat(product.price),
      quantity: parseInt(product.quantity, 10)
    });
  } catch (err) {
    console.error('[Product Service] GetProduct error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: CreateProduct
async function createProduct(call, callback) {
  const { pname, price, quantity } = call.request;

  if (!pname || price === undefined || quantity === undefined) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'pname, price, and quantity are required'
    });
  }

  try {
    const db = await connectDB();
    // Generate next pid
    const lastProduct = await db.collection('products').find({}).sort({ pid: -1 }).limit(1).toArray();
    const nextPid = (lastProduct.length > 0 && lastProduct[0].pid ? lastProduct[0].pid : 0) + 1;

    const newProduct = {
      pid: nextPid,
      pname,
      price: parseFloat(price),
      quantity: parseInt(quantity, 10),
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('products').insertOne(newProduct);
    console.log(`[Product Service] Created product: ${pname} (pid: ${nextPid})`);

    return callback(null, {
      pid: newProduct.pid,
      pname: newProduct.pname,
      price: newProduct.price,
      quantity: newProduct.quantity
    });
  } catch (err) {
    console.error('[Product Service] CreateProduct error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: UpdateProduct
async function updateProduct(call, callback) {
  const { pid, pname, price, quantity } = call.request;

  if (!pid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'pid is required'
    });
  }

  try {
    const db = await connectDB();
    const updateDoc = { updated_at: new Date() };
    if (pname) updateDoc.pname = pname;
    if (price !== undefined) updateDoc.price = parseFloat(price);
    if (quantity !== undefined) updateDoc.quantity = parseInt(quantity, 10);

    const result = await db.collection('products').findOneAndUpdate(
      { pid: parseInt(pid, 10) },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Product with pid ${pid} not found`
      });
    }

    return callback(null, {
      pid: result.pid,
      pname: result.pname,
      price: parseFloat(result.price),
      quantity: parseInt(result.quantity, 10)
    });
  } catch (err) {
    console.error('[Product Service] UpdateProduct error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: DeleteProduct
async function deleteProduct(call, callback) {
  const { pid } = call.request;

  if (!pid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'pid is required'
    });
  }

  try {
    const db = await connectDB();
    const result = await db.collection('products').deleteOne({ pid: parseInt(pid, 10) });

    if (result.deletedCount === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Product with pid ${pid} not found`
      });
    }

    return callback(null, {
      message: 'Product deleted successfully',
      pid: parseInt(pid, 10)
    });
  } catch (err) {
    console.error('[Product Service] DeleteProduct error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: CheckAndReserveStock (Synchronous inventory check and decrement for Order Service)
async function checkAndReserveStock(call, callback) {
  const { items } = call.request;

  if (!items || items.length === 0) {
    return callback(null, {
      success: false,
      message: 'Items list cannot be empty',
      reserved_items: []
    });
  }

  try {
    const db = await connectDB();
    const pids = items.map((i) => parseInt(i.pid, 10));

    const products = await db.collection('products').find({ pid: { $in: pids } }).toArray();
    const productMap = new Map(products.map((p) => [p.pid, p]));

    // Check all products exist and have sufficient stock
    const reservedDetails = [];
    for (const item of items) {
      const pid = parseInt(item.pid, 10);
      const qty = parseInt(item.qty, 10);
      const product = productMap.get(pid);

      if (!product) {
        return callback(null, {
          success: false,
          message: `Product with pid ${pid} not found`,
          reserved_items: []
        });
      }

      if (product.quantity < qty) {
        return callback(null, {
          success: false,
          message: `Insufficient stock for product '${product.pname}' (pid: ${pid}). Available: ${product.quantity}, requested: ${qty}`,
          reserved_items: []
        });
      }

      reservedDetails.push({
        pid,
        pname: product.pname,
        unit_price: parseFloat(product.price),
        qty
      });
    }

    // Decrement stock atomically
    for (const item of items) {
      await db.collection('products').updateOne(
        { pid: parseInt(item.pid, 10) },
        { $inc: { quantity: -parseInt(item.qty, 10) } }
      );
    }

    console.log('[Product Service] Reserved stock successfully for items:', items);

    return callback(null, {
      success: true,
      message: 'Stock reserved successfully',
      reserved_items: reservedDetails
    });
  } catch (err) {
    console.error('[Product Service] CheckAndReserveStock error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

function startServer() {
  const server = new grpc.Server();
  server.addService(productProto.ProductService.service, {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    checkAndReserveStock
  });

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('[Product Service] Failed to bind port:', err);
        process.exit(1);
      }
      console.log(`[Product Service] gRPC server running at 0.0.0.0:${port}`);
    }
  );
}

startServer();
