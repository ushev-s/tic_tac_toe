export const runtime = 'nodejs';

import { createClient, Errors } from '@farcaster/quick-auth';
const client: any = createClient();

// helper to read header from Headers|object
function getHeader(req: Request | any, name: string): string | null {
  const h = (req as any)?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  const v = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
  return Array.isArray(v) ? v[0] : v ?? null;
}

export async function requireUser(req: Request | any) {
  const auth = getHeader(req, 'authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return { error: new Response(JSON.stringify({ error: 'Missing token' }), { status: 401 }) };
  }
  const token = auth.split(' ')[1]!;

  const fwdHost = getHeader(req, 'x-forwarded-host');
  const hostHdr = getHeader(req, 'host');
  const domain =
    fwdHost ||
    hostHdr ||
    (() => {
      try {
        return new URL((req as any).url, 'https://example.org').host;
      } catch {
        return '';
      }
    })();

  try {
    const verify = client.verifyToken?.bind(client) || client.verifyJwt?.bind(client);
    if (!verify) throw new Error('QuickAuth verify method not found');
    const payload: any = await verify({ token, domain });
    return { fid: Number(payload.sub) };
  } catch (e: any) {
    if (Errors && e instanceof Errors.InvalidTokenError) {
      return { error: new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }) };
    }
    return { error: new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 }) };
  }
}
