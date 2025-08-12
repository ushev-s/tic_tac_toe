export const runtime = 'edge';

import { createClient, Errors } from '@farcaster/quick-auth';

const client = createClient();

export async function requireUser(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { error: new Response(JSON.stringify({ error: 'Missing token' }), { status: 401 }) };
  }
  const token = auth.split(' ')[1]!;
  const host = req.headers.get('x-forwarded-host') ?? new URL(req.url).host;

  try {
    // В 0.0.7 метод называется verifyToken
    const payload = await client.verifyToken({ token, domain: host });
    // sub — это fid
    return { fid: Number(payload.sub) };
  } catch (e) {
    if (e instanceof Errors.InvalidTokenError) {
      return { error: new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }) };
    }
    return { error: new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 }) };
  }
}
