import express from 'express';
import cors from 'cors';
import { requestLogger } from './middleware/logger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { authRouter } from './routes/auth.routes.js';
import { customerRouter } from './routes/customer.routes.js';
import { productRouter } from './routes/product.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { shipmentRouter } from './routes/shipment.routes.js';
import { healthRouter } from './routes/health.routes.js';

const app = express();
const PORT = process.env.PORT || 8080;

// Core Middlewares
app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(rateLimiter);

// Route Registrations
app.use('/api/auth', authRouter);
app.use('/api/customers', customerRouter);
app.use('/api/products', productRouter);
app.use('/api/orders', orderRouter);
app.use('/api/shipments', shipmentRouter);
app.use('/api/health', healthRouter);

// 404 Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[API Gateway] Unhandled error:', err);
  res.status(500).json({
    error: 'InternalServerError',
    message: err.message || 'An unexpected error occurred'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  E-Commerce API Gateway running on port ${PORT}   `);
  console.log(`====================================================`);
});
