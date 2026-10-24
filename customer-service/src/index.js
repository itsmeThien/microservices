import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../protos/customer.proto');
const PORT = process.env.PORT || '50052';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const customerProto = grpc.loadPackageDefinition(packageDefinition).customer;

// RPC: GetCustomer
async function getCustomer(call, callback) {
  const { uid } = call.request;

  if (!uid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'User ID (uid) is required'
    });
  }

  try {
    const result = await pool.query(
      `SELECT c.uid, c.fullname, c.mid, m.mname, m.score
       FROM customers c
       JOIN memberships m ON c.mid = m.mid
       WHERE c.uid = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      // Check if user exists without customer record, create default profile
      // or return NOT_FOUND (as per TC-CUS-02)
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Customer with uid ${uid} not found`
      });
    }

    const customer = result.rows[0];
    return callback(null, {
      uid: customer.uid,
      fullname: customer.fullname,
      mid: customer.mid,
      mname: customer.mname,
      score: customer.score
    });
  } catch (err) {
    console.error('[Customer Service] GetCustomer error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: UpdateCustomer
async function updateCustomer(call, callback) {
  const { uid, fullname, mid } = call.request;

  if (!uid || !fullname) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'uid and fullname are required'
    });
  }

  try {
    const targetMid = mid || 1;

    // Check customer exists
    const check = await pool.query('SELECT uid FROM customers WHERE uid = $1', [uid]);

    if (check.rows.length === 0) {
      // Insert new if not found
      await pool.query(
        'INSERT INTO customers (uid, fullname, mid) VALUES ($1, $2, $3)',
        [uid, fullname, targetMid]
      );
    } else {
      await pool.query(
        'UPDATE customers SET fullname = $1, mid = $2 WHERE uid = $3',
        [fullname, targetMid, uid]
      );
    }

    return callback(null, {
      message: 'Customer updated successfully',
      uid
    });
  } catch (err) {
    console.error('[Customer Service] UpdateCustomer error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: GetMembership
async function getMembership(call, callback) {
  const { mid } = call.request;

  if (!mid) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'Membership ID (mid) is required'
    });
  }

  try {
    const result = await pool.query(
      'SELECT mid, mname, score FROM memberships WHERE mid = $1',
      [mid]
    );

    if (result.rows.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `Membership with mid ${mid} not found`
      });
    }

    const row = result.rows[0];
    return callback(null, {
      mid: row.mid,
      mname: row.mname,
      score: row.score
    });
  } catch (err) {
    console.error('[Customer Service] GetMembership error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

function startServer() {
  const server = new grpc.Server();
  server.addService(customerProto.CustomerService.service, {
    getCustomer,
    updateCustomer,
    getMembership
  });

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('[Customer Service] Failed to bind port:', err);
        process.exit(1);
      }
      console.log(`[Customer Service] gRPC server running at 0.0.0.0:${port}`);
    }
  );
}

startServer();
