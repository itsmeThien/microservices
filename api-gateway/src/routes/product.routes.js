import { Router } from 'express';
import { productClient, callGrpc, grpcToHttpError } from '../grpcClients.js';
import { authenticateJWT, authorizeRoles } from '../middleware/auth.js';
import { redis } from '../redis.js';

export const productRouter = Router();

const CACHE_TTL_SECONDS = 60;

// Helper to invalidate product cache keys
async function invalidateProductCache() {
  try {
    const keys = await redis.keys('cache:products*');
    if (keys && keys.length > 0) {
      await redis.del(...keys);
      console.log(`[API Gateway] Invalidated ${keys.length} product cache key(s)`);
    }
  } catch (err) {
    console.warn('[API Gateway] Cache invalidation warning:', err.message);
  }
}

// GET /api/products (with Redis Caching)
productRouter.get('/', authenticateJWT, async (req, res) => {
  const cacheKey = 'cache:products:all';

  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(JSON.parse(cachedData));
    }
  } catch (err) {
    console.warn('[Cache] Redis read error, fetching from service:', err.message);
  }

  try {
    const result = await callGrpc(productClient, 'getProducts', {});

    // Save to Redis cache
    redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
    res.setHeader('X-Cache', 'MISS');

    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// GET /api/products/:pid (with Redis Caching)
productRouter.get('/:pid', authenticateJWT, async (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  if (isNaN(pid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid pid parameter' });
  }

  const cacheKey = `cache:products:${pid}`;

  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(JSON.parse(cachedData));
    }
  } catch (err) {
    console.warn('[Cache] Redis read error:', err.message);
  }

  try {
    const result = await callGrpc(productClient, 'getProduct', { pid });

    redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
    res.setHeader('X-Cache', 'MISS');

    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// POST /api/products (Admin Only)
productRouter.post('/', authenticateJWT, authorizeRoles('Admin'), async (req, res) => {
  const { pname, price, quantity } = req.body;

  if (!pname || price === undefined || quantity === undefined) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'pname, price, and quantity are required'
    });
  }

  try {
    const result = await callGrpc(productClient, 'createProduct', {
      pname,
      price: parseFloat(price),
      quantity: parseInt(quantity, 10)
    });

    await invalidateProductCache();
    return res.status(201).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// PUT /api/products/:pid (Admin Only)
productRouter.put('/:pid', authenticateJWT, authorizeRoles('Admin'), async (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  const { pname, price, quantity } = req.body;

  if (isNaN(pid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid pid parameter' });
  }

  try {
    const result = await callGrpc(productClient, 'updateProduct', {
      pid,
      pname: pname || '',
      price: price !== undefined ? parseFloat(price) : 0,
      quantity: quantity !== undefined ? parseInt(quantity, 10) : 0
    });

    await invalidateProductCache();
    return res.status(200).json({
      message: 'Product updated successfully',
      product: result
    });
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// DELETE /api/products/:pid (Admin Only)
productRouter.delete('/:pid', authenticateJWT, authorizeRoles('Admin'), async (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  if (isNaN(pid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid pid parameter' });
  }

  try {
    const result = await callGrpc(productClient, 'deleteProduct', { pid });
    await invalidateProductCache();
    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});
