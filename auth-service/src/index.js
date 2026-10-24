import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../protos/auth.proto');
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-ecommerce-jwt-key-2026';
const PORT = process.env.PORT || '50051';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

// RPC: Register
async function register(call, callback) {
  const { username, password, email, phone } = call.request;

  if (!username || !password) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'Username and password are required'
    });
  }

  try {
    // Check duplicate
    const checkUser = await pool.query(
      'SELECT uid FROM users WHERE username = $1 OR (email IS NOT NULL AND email = $2)',
      [username, email || '']
    );

    if (checkUser.rows.length > 0) {
      return callback({
        code: grpc.status.ALREADY_EXISTS,
        message: 'Username or email already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const roleId = 2; // Default: Customer

    const result = await pool.query(
      `INSERT INTO users (username, password, email, phone, roleid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING uid`,
      [username, hashedPassword, email || null, phone || null, roleId]
    );

    const uid = result.rows[0].uid;
    console.log(`[Auth Service] Registered user: ${username} (uid: ${uid})`);

    return callback(null, {
      message: 'User registered successfully',
      uid
    });
  } catch (err) {
    console.error('[Auth Service] Register error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: Login
async function login(call, callback) {
  const { username, password } = call.request;

  if (!username || !password) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'Username and password are required'
    });
  }

  try {
    const result = await pool.query(
      `SELECT u.uid, u.username, u.password, r.rolename
       FROM users u
       JOIN roles r ON u.roleid = r.roleid
       WHERE u.username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: 'Invalid username or password'
      });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: 'Invalid username or password'
      });
    }

    const expiresIn = 3600; // 1 hour
    const token = jwt.sign(
      {
        sub: user.uid,
        uid: user.uid,
        username: user.username,
        role: user.rolename
      },
      JWT_SECRET,
      { expiresIn }
    );

    console.log(`[Auth Service] User logged in: ${username} (role: ${user.rolename})`);

    return callback(null, {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn
    });
  } catch (err) {
    console.error('[Auth Service] Login error:', err);
    return callback({
      code: grpc.status.INTERNAL,
      message: 'Internal server error: ' + err.message
    });
  }
}

// RPC: ValidateToken
async function validateToken(call, callback) {
  const { token } = call.request;

  if (!token) {
    return callback(null, { valid: false, uid: 0, username: '', role: '' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return callback(null, {
      valid: true,
      uid: decoded.uid || decoded.sub,
      username: decoded.username || '',
      role: decoded.role || 'Customer'
    });
  } catch (err) {
    return callback(null, { valid: false, uid: 0, username: '', role: '' });
  }
}

function startServer() {
  const server = new grpc.Server();
  server.addService(authProto.AuthService.service, {
    register,
    login,
    validateToken
  });

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('[Auth Service] Failed to bind port:', err);
        process.exit(1);
      }
      console.log(`[Auth Service] gRPC server running at 0.0.0.0:${port}`);
    }
  );
}

startServer();
