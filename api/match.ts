export const runtime = 'nodejs';

import { Redis } from '@upstash/redis';
import { requireUser } from './_lib/auth';
import { rateLimit, getClientIp } from './_lib/rateLimit';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

// PROD defaults
const RL_FID_LIMIT = Number(process.env.RL_FID_LIMIT ?? 60);
const RL_FID_WINDOW = Number(process.env.RL_FID_WINDOW ?? 60);
const RL_IP_LIMIT = Number(process.env.RL_IP_LIMIT ?? 120);
const RL_IP_WINDOW = Number(process.env.RL_IP_WINDOW ?? 60);

type Body = { outcome: 'x' | 'o' | 'draw' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await requireUser(req);
  if ('error' in user) return user.error;
  const fid = String(user.fid);
  const ip = getClientIp(req);

  const [okFid, okIp] = await Promise.all([
    rateLimit(redis, `rl:fid:${fid}`, { limit: RL_FID_LIMIT, windowSec: RL_FID_WINDOW }),
    rateLimit(redis, `rl:ip:${ip}`, { limit: RL_IP_LIMIT, windowSec: RL_IP_WINDOW })
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
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (!['x', 'o', 'draw'].includes(body.outcome))
    return new Response('Bad outcome', { status: 400 });

  const userKey = `user:${fid}`;

  if (body.outcome === 'x') {
    await Promise.all([redis.hincrby(userKey, 'wins', 1), redis.zincrby('lb:wins', 1, fid)]);
  } else if (body.outcome === 'o') {
    await redis.hincrby(userKey, 'losses', 1);
  } else {
    await redis.hincrby(userKey, 'draws', 1);
  }

  await redis.hset(userKey, { fid, updated_at: Date.now() });
  return Response.json({ ok: true });
}
