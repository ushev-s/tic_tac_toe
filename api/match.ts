export const runtime = 'edge';

import { kv } from '@vercel/kv';
import { requireUser } from './lib/auth';

type Body = { outcome: 'x' | 'o' | 'draw' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await requireUser(req);
  if ('error' in user) return user.error;
  const fid = user.fid;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (!['x', 'o', 'draw'].includes(body.outcome))
    return new Response('Bad outcome', { status: 400 });

  if (body.outcome === 'x') {
    await kv.hincrby(`user:${fid}`, 'wins', 1);
    await kv.zincrby('lb:wins', 1, String(fid));
  } else if (body.outcome === 'o') {
    await kv.hincrby(`user:${fid}`, 'losses', 1);
  } else {
    await kv.hincrby(`user:${fid}`, 'draws', 1);
  }

  await kv.hset(`user:${fid}`, { fid, updated_at: Date.now() });

  return Response.json({ ok: true });
}
