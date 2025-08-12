export const runtime = 'nodejs';

import { Redis } from '@upstash/redis';
import { rateLimit, getClientIp } from './_lib/rateLimit.js';
import { requireUser } from './_lib/auth.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

function getHeader(req: Request | any, name: string): string | null {
  const h = (req as any)?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  const v = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
  return Array.isArray(v) ? v[0] : v ?? null;
}

// === PROD defaults for leaderboard ===
const RL_FID_LIMIT = Number(process.env.RL_LB_FID_LIMIT ?? 120);
const RL_FID_WINDOW = Number(process.env.RL_LB_FID_WINDOW ?? 60);
const RL_IP_LIMIT = Number(process.env.RL_LB_IP_LIMIT ?? 300);
const RL_IP_WINDOW = Number(process.env.RL_LB_IP_WINDOW ?? 60);

export default async function handler(req: Request | any): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const ip = getClientIp(req);

  // optional auth → per-fid rate limit
  let fid: string | null = null;
  const authHeader = getHeader(req, 'authorization'); // <-- фикс
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const user = await requireUser(req);
    if (!('error' in user)) fid = String(user.fid);
  }

  const [okFid, okIp] = await Promise.all([
    fid
      ? rateLimit(redis, `rl:lb:fid:${fid}`, { limit: RL_FID_LIMIT, windowSec: RL_FID_WINDOW })
      : Promise.resolve(true),
    rateLimit(redis, `rl:lb:ip:${ip}`, { limit: RL_IP_LIMIT, windowSec: RL_IP_WINDOW })
  ]);
  if (!okFid || !okIp) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded', scope: !okFid ? 'fid' : 'ip' }),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' }
      }
    );
  }

  const url = new URL(typeof req.url === 'string' ? req.url : '', 'https://example.org');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10), 100);

  const rows = (await redis.zrange('lb:wins', 0, limit - 1, { withScores: true, rev: true })) as {
    member: string;
    score: number;
  }[];

  const keys = rows.map((r) => `user:${r.member}`);
  const entries = await Promise.all(
    keys.map(async (k, i) => {
      const h = (await redis.hgetall<Record<string, string | number>>(k)) || {};
      return {
        fid: Number(rows[i].member),
        wins: Number(rows[i].score ?? h.wins ?? 0),
        losses: Number(h.losses ?? 0),
        draws: Number(h.draws ?? 0),
        username: (h.username as string) || null
      };
    })
  );

  return new Response(JSON.stringify({ entries }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 's-maxage=5, stale-while-revalidate=30'
    }
  });
}
