export async function onRequestPost({ request, env }) {
  const data = await request.json().catch(() => ({}));
  const userId = String(data.userId || '').trim();
  if (!userId) return Response.json({ ok: false, error: 'userId required' }, { status: 400 });

  const now = Date.now();
  const key = `user:${userId}`;
  const current = await env.PLAYERS.get(key, 'json') || {};
  const next = {
    userId,
    firstSeen: current.firstSeen || now,
    lastSeen: now,
    gamesPlayed: Number(data.gamesPlayed ?? current.gamesPlayed ?? 0),
    locked: Boolean(data.event === 'locked' || current.locked),
    lockReason: data.reason || current.lockReason || '',
    clicked: Boolean(data.event === 'partner_click' || current.clicked),
    resetAt: Number(current.resetAt || 0)
  };

  await env.PLAYERS.put(key, JSON.stringify(next));
  await env.PLAYERS.put(`seen:${userId}`, String(now));

  return Response.json({ ok: true, resetAt: next.resetAt });
}
