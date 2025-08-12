export const runtime = 'nodejs';

import { Redis } from '@upstash/redis';
import { rateLimit, getClientIp } from './_lib/rateLimit.js';
import { requireUser } from './_lib/auth.js';
import { getHeader, safeUrl, withTimeout } from './_lib/util.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 3000);

// Leaderboard RL defaults
const RL_FID_LIMIT = Number(process.env.RL_LB_FID_LIMIT ?? 120);
const RL_FID_WINDOW = Number(process.env.RL_LB_FID_WINDOW ?? 60);
const RL_IP_LIMIT = Number(process.env.RL_LB_IP_LIMIT ?? 300);
const RL_IP_WINDOW = Number(process.env.RL_LB_IP_WINDOW ?? 60);

export default async function handler(req: Request | any): Promise<Response> {
  try {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    const ip = getClientIp(req);

    // optional auth → per-fid RL
    let fid: string | null = null;
    const authHeader = getHeader(req, 'authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      const user = await requireUser(req);
      if (!('error' in user)) fid = String(user.fid);
    }

    const [okFid, okIp] = await Promise.all([
      fid
        ? rateLimit(redis, `rl:lb:fid:${fid}`, {
            limit: RL_FID_LIMIT,
            windowSec: RL_FID_WINDOW,
            timeoutMs: API_TIMEOUT_MS
          })
        : Promise.resolve(true),
      rateLimit(redis, `rl:lb:ip:${ip}`, {
        limit: RL_IP_LIMIT,
        windowSec: RL_IP_WINDOW,
        timeoutMs: API_TIMEOUT_MS
      })
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

    const url = safeUrl(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10), 100);

    const rows = (await withTimeout(
      redis.zrange('lb:wins', 0, limit - 1, { withScores: true, rev: true }),
      API_TIMEOUT_MS,
      'zrange'
    )) as { member: string; score: number }[];

    const entries = await Promise.all(
      rows.map(async (row) => {
        const h =
          (await withTimeout(
            redis.hgetall<Record<string, string | number>>(`user:${row.member}`),
            API_TIMEOUT_MS,
            'hgetall'
          )) || {};
        return {
          fid: Number(row.member),
          wins: Number(row.score ?? h.wins ?? 0),
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
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: 'Server error', message: e?.message ?? String(e) }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' }
      }
    );
  }
}
