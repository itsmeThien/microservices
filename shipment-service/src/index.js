import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { connectDB } from './db.js';
import { startKafkaConsumer } from './kafkaConsumer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../protos/shipment.proto');
const PORT = process.env.PORT || '50055';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const shipmentProto = grpc.loadPackageDefinition(packageDefinition).shipment;

const VALID_STATUSES = ['PENDING', 'SHIPPING', 'DELIVERED', 'CANCELLED'];

// RPC: GetShipment
async function getShipment(call, callback) {
  const { shipid } = call.request;

  if (!shipid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'shipid is required'
    });
  }

  try {
    const db = await connectDB();
    const shipment = await db.collection('shipments').findOne({ shipid: parseInt(shipid, 10) });

    if (!shipment) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Shipment with shipid ${shipid} not found`
      });
    }

    return callback(null, {
      shipid: shipment.shipid,
      oid: shipment.oid,
      status: shipment.status,
      created_at: shipment.created_at ? shipment.created_at.toISOString() : '',
      updated_at: shipment.updated_at ? shipment.updated_at.toISOString() : ''
    });
  } catch (err) {
    console.error('[Shipment Service] GetShipment error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: UpdateShipmentStatus
async function updateShipmentStatus(call, callback) {
  const { shipid, status } = call.request;

  if (!shipid || !status) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'shipid and status are required'
    });
  }

  const normalizedStatus = status.toUpperCase().trim();
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}`
    });
  }

  try {
    const db = await connectDB();
    const result = await db.collection('shipments').findOneAndUpdate(
      { shipid: parseInt(shipid, 10) },
      {
        $set: {
          status: normalizedStatus,
          updated_at: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Shipment with shipid ${shipid} not found`
      });
    }

    console.log(`[Shipment Service] Updated shipment #${shipid} to status: ${normalizedStatus}`);

    return callback(null, {
      shipid: result.shipid,
      oid: result.oid,
      status: result.status,
      created_at: result.created_at ? result.created_at.toISOString() : '',
      updated_at: result.updated_at ? result.updated_at.toISOString() : ''
    });
  } catch (err) {
    console.error('[Shipment Service] UpdateShipmentStatus error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

function startServer() {
  const server = new grpc.Server();
  server.addService(shipmentProto.ShipmentService.service, {
    getShipment,
    updateShipmentStatus
  });

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('[Shipment Service] Failed to bind port:', err);
        process.exit(1);
      }
      console.log(`[Shipment Service] gRPC server running at 0.0.0.0:${port}`);
      // Start Kafka consumer to listen for OrderCreated events
      startKafkaConsumer();
    }
  );
}

startServer();
