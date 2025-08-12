export const runtime = 'nodejs';

import { Redis } from '@upstash/redis';
import { requireUser } from './_lib/auth.js';
import { rateLimit, getClientIp } from './_lib/rateLimit.js';
import { withTimeout } from './_lib/util.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 3000);

// Rate limits (override via env if needed)
const RL_FID_LIMIT = Number(process.env.RL_FID_LIMIT ?? 60);
const RL_FID_WINDOW = Number(process.env.RL_FID_WINDOW ?? 60);
const RL_IP_LIMIT = Number(process.env.RL_IP_LIMIT ?? 120);
const RL_IP_WINDOW = Number(process.env.RL_IP_WINDOW ?? 60);

type Body = { outcome: 'x' | 'o' | 'draw' };

export default async function handler(req: Request | any): Promise<Response> {
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const user = await requireUser(req);
    if ('error' in user) return user.error ?? new Response('Unauthorized', { status: 401 });
    const fid = String(user.fid);
    const ip = getClientIp(req);

    const [okFid, okIp] = await Promise.all([
      rateLimit(redis, `rl:fid:${fid}`, {
        limit: RL_FID_LIMIT,
        windowSec: RL_FID_WINDOW,
        timeoutMs: API_TIMEOUT_MS
      }),
      rateLimit(redis, `rl:ip:${ip}`, {
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

    let body: Body;
    try {
      body = await withTimeout(req.json(), API_TIMEOUT_MS, 'parse json');
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    if (!['x', 'o', 'draw'].includes(body.outcome))
      return new Response('Bad outcome', { status: 400 });

    const userKey = `user:${fid}`;

    if (body.outcome === 'x') {
      await Promise.all([
        withTimeout(redis.hincrby(userKey, 'wins', 1), API_TIMEOUT_MS, 'hincrby'),
        withTimeout(redis.zincrby('lb:wins', 1, fid), API_TIMEOUT_MS, 'zincrby')
      ]);
    } else if (body.outcome === 'o') {
      await withTimeout(redis.hincrby(userKey, 'losses', 1), API_TIMEOUT_MS, 'hincrby');
    } else {
      await withTimeout(redis.hincrby(userKey, 'draws', 1), API_TIMEOUT_MS, 'hincrby');
    }

    await withTimeout(redis.hset(userKey, { fid, updated_at: Date.now() }), API_TIMEOUT_MS, 'hset');

    return Response.json({ ok: true });
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
