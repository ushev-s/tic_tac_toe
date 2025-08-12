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
  await redis.expire(key, windowSec);

  return count <= limit;
}

export function getClientIp(req: Request | any): string {
  const h = (req as any)?.headers;
  if (!h) return 'ip:unknown';

  // Web/Edge: Headers instance
  if (typeof h.get === 'function') {
    const xf = h.get('x-forwarded-for') || '';
    const real = h.get('x-real-ip') || '';
    const ip = xf.split(',')[0].trim() || real;
    return ip || 'ip:unknown';
  }

  // Node.js: plain object (case-insensitive)
  const pick = (k: string) => {
    const v = h[k] ?? h[k.toLowerCase()] ?? h[k.toUpperCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const xf = (pick('x-forwarded-for') as string) || '';
  const real = (pick('x-real-ip') as string) || '';
  const ip = xf.split(',')[0].trim() || real;
  return ip || 'ip:unknown';
}
