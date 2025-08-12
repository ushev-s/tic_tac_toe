export const runtime = 'nodejs';

import { createClient, Errors } from '@farcaster/quick-auth';
import { getHeader, withTimeout } from './util.js';

const client: any = createClient();
const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 3000);

export async function requireUser(req: Request | any) {
  const auth = getHeader(req, 'authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return { error: new Response(JSON.stringify({ error: 'Missing token' }), { status: 401 }) };
  }
  const token = auth.split(' ')[1]!;
  const domain = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || '';

  try {
    const verify = client.verifyToken?.bind(client) || client.verifyJwt?.bind(client);
    if (!verify) throw new Error('QuickAuth verify method not found');

    const payload: any = await withTimeout(
      verify({ token, domain }),
      API_TIMEOUT_MS,
      'quickauth.verify'
    );
    return { fid: Number(payload.sub) };
  } catch (e: any) {
    if (Errors && e instanceof Errors.InvalidTokenError) {
      return { error: new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }) };
    }
    return { error: new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 }) };
  }
}
