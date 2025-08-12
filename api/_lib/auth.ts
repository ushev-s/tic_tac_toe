export const runtime = 'nodejs';

import { createClient, Errors } from '@farcaster/quick-auth';
const client: any = createClient();

export async function requireUser(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { error: new Response(JSON.stringify({ error: 'Missing token' }), { status: 401 }) };
  }
  const token = auth.split(' ')[1]!;
  const host = req.headers.get('x-forwarded-host') ?? new URL(req.url).host;

  try {
    const verify = client.verifyToken?.bind(client) || client.verifyJwt?.bind(client);

    if (!verify) throw new Error('QuickAuth verify method not found');

    const payload: any = await verify({ token, domain: host });
    return { fid: Number(payload.sub) };
  } catch (e: any) {
    if (e instanceof Errors?.InvalidTokenError) {
      return { error: new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }) };
    }
    return { error: new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 }) };
  }
}
