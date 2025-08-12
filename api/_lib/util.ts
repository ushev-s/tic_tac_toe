export const runtime = 'nodejs';

// Simple timeout wrapper (doesn't cancel the original promise, just races it).
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

// Read header from Headers | plain object (Node).
export function getHeader(req: Request | any, name: string): string | null {
  const h = (req as any)?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  const v = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
  return Array.isArray(v) ? v[0] : v ?? null;
}

// Construct URL even if req.url is relative in Node.
export function safeUrl(req: Request | any): URL {
  try {
    return new URL((req as any).url);
  } catch {
    return new URL((req as any).url ?? '/', 'https://example.org');
  }
}
