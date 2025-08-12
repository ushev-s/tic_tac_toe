export const runtime = 'edge';

import { Redis } from '@upstash/redis';

type Opts = { limit: number; windowSec: number };

/** Sliding-window per key with ZSET + TTL. */
export async function rateLimit(
  redis: Redis,
  key: string,
  { limit, windowSec }: Opts
): Promise<boolean> {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  await redis.zadd(key, { score: now, member: String(now) });
  await redis.zremrangebyscore(key, 0, now - windowMs);
  const count = await redis.zcard(key);
  await redis.expire(key, windowSec); // авто-очистка

  return count <= limit;
}

export function getClientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for') || '';
  const ip = xf.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  return ip || 'ip:unknown';
}
