export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export function getAdminIds(env) {
  return String(env.ADMIN_IDS || '')
    .split(/[;,\s]+/)
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export function isAdmin(env, userId) {
  const admins = getAdminIds(env);
  return admins.length === 0 || admins.includes(Number(userId));
}

export function partnerUrl(env) {
  return String(env.PARTNER_URL || 'https://partner-site.com').trim();
}

export function webappUrl(env, request) {
  const configured = String(env.WEBAPP_URL || '').trim();
  if (configured) return configured;
  return new URL(request.url).origin;
}

export async function tgApi(env, method, payload) {
  const token = String(env.BOT_TOKEN || '').trim();
  if (!token) throw new Error('BOT_TOKEN is not configured');

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`${method}: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function answerCallback(env, callbackQueryId, text = '') {
  if (!callbackQueryId) return;
  await tgApi(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  }).catch(() => {});
}

export function gameKeyboard(env, request) {
  return {
    inline_keyboard: [[
      { text: '🎮 Start', web_app: { url: webappUrl(env, request) } },
    ]],
  };
}

export function partnerKeyboard(url) {
  return {
    inline_keyboard: [[
      { text: 'Перейти на сайт', url },
    ]],
  };
}

export function adminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'admin:refresh' }],
      [{ text: '📣 Дожим', callback_data: 'admin:push' }],
      [{ text: '♻️ Сброс игроков', callback_data: 'admin:reset_all' }],
    ],
  };
}

export function userKey(userId) {
  return `user:${userId}`;
}

export async function getUser(env, userId) {
  if (!env.MINES_KV) throw new Error('MINES_KV binding is not configured');
  return (await env.MINES_KV.get(userKey(userId), 'json')) || null;
}

export async function saveUser(env, user) {
  if (!env.MINES_KV) throw new Error('MINES_KV binding is not configured');
  await env.MINES_KV.put(userKey(user.user_id), JSON.stringify(user));
}

export async function upsertUser(env, partial) {
  const ts = now();
  const userId = Number(partial.user_id || partial.id);
  if (!userId || !Number.isFinite(userId)) return null;

  const prev = (await getUser(env, userId)) || {};
  const user = {
    user_id: userId,
    username: partial.username ?? prev.username ?? '',
    first_name: partial.first_name ?? prev.first_name ?? '',
    joined_at: prev.joined_at || ts,
    last_seen_at: ts,
    blocked: Boolean(partial.blocked ?? prev.blocked ?? false),
    clicked: Boolean(partial.clicked ?? prev.clicked ?? false),
    click_count: Number(prev.click_count || 0) + (partial.clicked && !prev.clicked ? 1 : 0),
    games_count: Math.max(Number(prev.games_count || 0), Number(partial.games_count || 0)),
    last_reason: partial.reason ?? prev.last_reason ?? '',
  };

  await saveUser(env, user);
  return user;
}

export async function listUsers(env) {
  if (!env.MINES_KV) throw new Error('MINES_KV binding is not configured');
  const users = [];
  let cursor;

  do {
    const page = await env.MINES_KV.list({ prefix: 'user:', cursor });
    for (const key of page.keys) {
      const user = await env.MINES_KV.get(key.name, 'json');
      if (user) users.push(user);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return users;
}

export async function statsText(env) {
  const users = await listUsers(env);
  const dayAgo = now() - 24 * 60 * 60;
  const total = users.length;
  const users24h = users.filter((u) => Number(u.joined_at || 0) >= dayAgo).length;
  const clicked = users.filter((u) => u.clicked).length;
  const notClicked = users.filter((u) => !u.clicked).length;

  return [
    '📊 Статистика Mines',
    '',
    `Всего игроков: ${total}`,
    `Игроков за 24ч: ${users24h}`,
    `Перешли по ссылке: ${clicked}`,
    `Не перешли по ссылке: ${notClicked}`,
  ].join('\n');
}

export async function resetPlayers(env) {
  const users = await listUsers(env);
  for (const user of users) {
    await saveUser(env, {
      ...user,
      blocked: false,
      clicked: false,
      games_count: 0,
      last_reason: 'admin_reset',
      last_seen_at: now(),
    });
  }
  return users.length;
}
