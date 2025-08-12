export const runtime = 'edge';

import { kv } from '@vercel/kv';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10), 100);

  const rows = await kv.zrange<{ member: string; score: number }>('lb:wins', 0, limit - 1, {
    rev: true,
    withScores: true
  });

  const entries = await Promise.all(
    rows.map(async (row) => {
      const data = (await kv.hgetall<Record<string, string | number>>(`user:${row.member}`)) || {};
      return {
        fid: Number(row.member),
        wins: Number(row.score ?? data.wins ?? 0),
        losses: Number(data.losses ?? 0),
        draws: Number(data.draws ?? 0),
        username: (data.username as string) || null
      };
    })
  );

  return Response.json({ entries });
}
