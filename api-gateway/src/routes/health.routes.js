import { Router } from 'express';
import { redis } from '../redis.js';

export const healthRouter = Router();

// GET /api/health
healthRouter.get('/', async (req, res) => {
  let redisStatus = 'UNKNOWN';

  try {
    const pong = await redis.ping();
    redisStatus = pong === 'PONG' ? 'UP' : 'DOWN';
  } catch (err) {
    redisStatus = 'DOWN';
  }

  return res.status(200).json({
    status: 'UP',
    message: 'E-commerce API is running',
    timestamp: new Date().toISOString(),
    components: {
      apiGateway: 'UP',
      redis: redisStatus
    }
  });
});
