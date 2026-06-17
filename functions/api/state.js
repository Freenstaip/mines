export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const userId = String(url.searchParams.get('userId') || '').trim();
  if (!userId) return Response.json({ ok: false, error: 'userId required' }, { status: 400 });

  const user = await env.PLAYERS.get(`user:${userId}`, 'json') || {};
  return Response.json({ ok: true, resetAt: Number(user.resetAt || 0) });
}
