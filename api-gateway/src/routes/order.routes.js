import { Router } from 'express';
import { orderClient, callGrpc, grpcToHttpError } from '../grpcClients.js';
import { authenticateJWT } from '../middleware/auth.js';
import { redis } from '../redis.js';

export const orderRouter = Router();

// POST /api/orders
orderRouter.post('/', authenticateJWT, async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Order items must be a non-empty array'
    });
  }

  for (const item of items) {
    if (!item.pid || !item.qty || item.qty <= 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Each item must have a valid pid and qty > 0'
      });
    }
  }

  try {
    const result = await callGrpc(orderClient, 'createOrder', {
      uid: req.user.uid,
      items: items.map((i) => ({
        pid: parseInt(i.pid, 10),
        qty: parseInt(i.qty, 10)
      }))
    });

    // Invalidate product cache because stock has changed
    try {
      const keys = await redis.keys('cache:products*');
      if (keys && keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (_) {}

    return res.status(201).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// GET /api/orders
orderRouter.get('/', authenticateJWT, async (req, res) => {
  try {
    const result = await callGrpc(orderClient, 'getOrders', {
      uid: req.user.uid,
      role: req.user.role
    });

    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// GET /api/orders/:oid
orderRouter.get('/:oid', authenticateJWT, async (req, res) => {
  const oid = parseInt(req.params.oid, 10);
  if (isNaN(oid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid oid parameter' });
  }

  try {
    const result = await callGrpc(orderClient, 'getOrder', {
      oid,
      uid: req.user.uid,
      role: req.user.role
    });

    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});
