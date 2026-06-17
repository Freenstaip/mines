import { json, upsertUser } from '../_utils.js';

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();

    const user = await upsertUser(env, {
      user_id: data.userId,
      username: data.username,
      first_name: data.firstName,
      games_count: data.gamesCount,
      blocked: data.blocked,
      clicked: data.clicked,
      reason: data.reason || data.action || 'frontend_event',
    });

    return json({ ok: true, user });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) }, 500);
  }
}
