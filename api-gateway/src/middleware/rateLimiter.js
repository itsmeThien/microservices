import { redis } from '../redis.js';

const WINDOW_SIZE_IN_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10);
const MAX_REQUESTS_PER_WINDOW = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

export async function rateLimiter(req, res, next) {
  // Exclude health check from rate limiting
  if (req.path === '/api/health') {
    return next();
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const key = `ratelimit:${clientIp}`;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SIZE_IN_SECONDS);
    }

    const ttl = await redis.ttl(key);

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS_PER_WINDOW - current));
    res.setHeader('X-RateLimit-Reset', ttl);

    if (current > MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${ttl} seconds.`
      });
    }

    next();
  } catch (err) {
    // If Redis is unreachable, fail-open to not block users, but log warning
    console.warn('[RateLimiter] Redis failure, bypassing rate limiter:', err.message);
    next();
  }
}
