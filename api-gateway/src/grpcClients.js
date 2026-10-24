import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOS_DIR = process.env.PROTOS_DIR || path.resolve(__dirname, '../../protos');

function loadProto(fileName, pkgName) {
  const filePath = path.join(PROTOS_DIR, fileName);
  const def = protoLoader.loadSync(filePath, {
    keepCase: true,
    longs: String,
    defaults: true,
    oneofs: true
  });
  return grpc.loadPackageDefinition(def)[pkgName];
}

const authProto = loadProto('auth.proto', 'auth');
const customerProto = loadProto('customer.proto', 'customer');
const productProto = loadProto('product.proto', 'product');
const orderProto = loadProto('order.proto', 'order');
const shipmentProto = loadProto('shipment.proto', 'shipment');

export const authClient = new authProto.AuthService(
  process.env.AUTH_SERVICE_URL || 'auth-service:50051',
  grpc.credentials.createInsecure()
);

export const customerClient = new customerProto.CustomerService(
  process.env.CUSTOMER_SERVICE_URL || 'customer-service:50052',
  grpc.credentials.createInsecure()
);

export const productClient = new productProto.ProductService(
  process.env.PRODUCT_SERVICE_URL || 'product-service:50053',
  grpc.credentials.createInsecure()
);

export const orderClient = new orderProto.OrderService(
  process.env.ORDER_SERVICE_URL || 'order-service:50054',
  grpc.credentials.createInsecure()
);

export const shipmentClient = new shipmentProto.ShipmentService(
  process.env.SHIPMENT_SERVICE_URL || 'shipment-service:50055',
  grpc.credentials.createInsecure()
);

// Map gRPC status codes to HTTP status codes
export function grpcToHttpError(err) {
  let status = 500;
  let errorName = 'InternalServerError';

  switch (err.code) {
    case grpc.status.INVALID_ARGUMENT: // 3
      status = 400;
      errorName = 'BadRequest';
      break;
    case grpc.status.NOT_FOUND: // 5
      status = 404;
      errorName = 'NotFound';
      break;
    case grpc.status.ALREADY_EXISTS: // 6
      status = 409;
      errorName = 'Conflict';
      break;
    case grpc.status.PERMISSION_DENIED: // 7
      status = 403;
      errorName = 'Forbidden';
      break;
    case grpc.status.FAILED_PRECONDITION: // 9
      status = 409;
      errorName = 'Conflict';
      break;
    case grpc.status.UNAUTHENTICATED: // 16
      status = 401;
      errorName = 'Unauthorized';
      break;
    case grpc.status.UNAVAILABLE: // 14
      status = 503;
      errorName = 'ServiceUnavailable';
      break;
    default:
      status = 500;
      errorName = 'InternalServerError';
      break;
  }

  return {
    status,
    body: {
      error: errorName,
      message: err.details || err.message || 'An error occurred'
    }
  };
}

export function callGrpc(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}
