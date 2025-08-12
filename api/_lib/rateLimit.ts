export const runtime = 'nodejs';

import type { Redis } from '@upstash/redis';
import { withTimeout } from './util.js';

type Opts = { limit: number; windowSec: number; timeoutMs: number };

/** Sliding-window per key (ZSET + TTL). Returns true if allowed. */
export async function rateLimit(
  redis: Redis,
  key: string,
  { limit, windowSec, timeoutMs }: Opts
): Promise<boolean> {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  try {
    // 1) add current event
    await withTimeout(redis.zadd(key, { score: now, member: String(now) }), timeoutMs, 'rl:zadd');
    // 2) drop old events
    await withTimeout(redis.zremrangebyscore(key, 0, now - windowMs), timeoutMs, 'rl:zremrange');
    // 3) count
    const count = await withTimeout(redis.zcard(key), timeoutMs, 'rl:zcard');
    // 4) expire
    await withTimeout(redis.expire(key, windowSec), timeoutMs, 'rl:expire');

    return count <= limit;
  } catch {
    // On failure, fail "open" to avoid bricking gameplay — but you can flip to false to be stricter.
    return true;
  }
}

// Best-effort IP extraction
export function getClientIp(req: Request | any): string {
  const h = (req as any)?.headers;
  if (!h) return 'ip:unknown';
  if (typeof h.get === 'function') {
    const xf = h.get('x-forwarded-for') || '';
    const real = h.get('x-real-ip') || '';
    return xf.split(',')[0].trim() || real || 'ip:unknown';
  }
  const pick = (k: string) => {
    const v = h[k] ?? h[k.toLowerCase()] ?? h[k.toUpperCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const xf = (pick('x-forwarded-for') as string) || '';
  const real = (pick('x-real-ip') as string) || '';
  return xf.split(',')[0].trim() || real || 'ip:unknown';
}
