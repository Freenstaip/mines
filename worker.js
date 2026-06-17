const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    try {
      if (url.pathname === '/api/player' && request.method === 'GET') return withCors(await getPlayer(request, env));
      if (url.pathname === '/api/track' && request.method === 'POST') return withCors(await trackEvent(request, env));
      if (url.pathname === '/bot' && request.method === 'POST') return await telegramWebhook(request, env);
      if (url.pathname === '/set-webhook' && request.method === 'GET') return await setWebhook(request, env);
      return new Response('Not found', { status: 404 });
    } catch (error) {
      return withCors(json({ ok: false, error: error.message || 'Server error' }, 500));
    }
  }
};

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-user-id'
  };
}

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getKv(env) {
  if (!env.MINES_KV) throw new Error('MINES_KV is not bound. Create KV namespace and bind it as MINES_KV.');
  return env.MINES_KV;
}

function partnerUrl(env) {
  return env.PARTNER_URL || 'https://example.com';
}

function adminIds(env) {
  return String(env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function playerKey(userId) {
  return `player:${userId}`;
}

async function readPlayer(env, userId) {
  const kv = getKv(env);
  const existing = await kv.get(playerKey(userId), 'json');
  if (existing) return existing;
  return {
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visits: 0,
    gamesPlayed: 0,
    locked: false,
    clickedPartner: false,
    resetNonce: ''
  };
}

async function writePlayer(env, userId, data) {
  const kv = getKv(env);
  const next = { ...data, userId, updatedAt: new Date().toISOString() };
  await kv.put(playerKey(userId), JSON.stringify(next));
  return next;
}

async function getPlayer(request, env) {
  const url = new URL(request.url);
  const userId = String(url.searchParams.get('userId') || request.headers.get('x-user-id') || 'demo-user');
  const player = await readPlayer(env, userId);
  if (!player.firstSeenAt) player.firstSeenAt = player.createdAt || new Date().toISOString();
  player.visits = Number(player.visits || 0) + 1;
  await writePlayer(env, userId, player);
  return json({
    ok: true,
    userId,
    locked: Boolean(player.locked),
    clickedPartner: Boolean(player.clickedPartner),
    resetNonce: player.resetNonce || '',
    partnerUrl: partnerUrl(env)
  });
}

async function trackEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || request.headers.get('x-user-id') || 'demo-user');
  const player = await readPlayer(env, userId);
  const now = new Date().toISOString();

  player.firstSeenAt ||= now;
  player.lastSeenAt = now;
  player.visits = Number(player.visits || 0) + (body.event === 'visit' ? 1 : 0);

  if (body.event === 'game_finished') {
    player.gamesPlayed = Math.max(Number(player.gamesPlayed || 0), Number(body.gamesPlayed || body.state?.gamesPlayed || 0));
    player.lastResult = body.result || player.lastResult;
    player.balance = Number(body.balance ?? body.state?.balance ?? player.balance ?? 10);
  }

  if (body.event === 'locked') player.locked = true;
  if (body.event === 'partner_click') {
    player.locked = true;
    player.clickedPartner = true;
    player.clickedAt = now;
  }

  if (body.state) {
    player.localGamesPlayed = Number(body.state.gamesPlayed || player.localGamesPlayed || 0);
    player.localBalance = Number(body.state.balance ?? player.localBalance ?? 10);
  }

  await writePlayer(env, userId, player);
  return json({ ok: true });
}

async function listPlayers(env) {
  const kv = getKv(env);
  const result = await kv.list({ prefix: 'player:' });
  const players = [];
  for (const key of result.keys) {
    const player = await kv.get(key.name, 'json');
    if (player) players.push(player);
  }
  return players;
}

function isAdmin(env, id) {
  return adminIds(env).includes(String(id));
}

async function telegramWebhook(request, env) {
  const update = await request.json().catch(() => ({}));
  const message = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from;
  const chatId = message?.chat?.id;
  const text = update.message?.text || '';
  const data = update.callback_query?.data || '';

  if (!from || !chatId) return json({ ok: true });
  if (!isAdmin(env, from.id)) {
    if (text.startsWith('/admin')) await sendMessage(env, chatId, 'У вас нет доступа к админке.');
    return json({ ok: true });
  }

  if (update.callback_query?.id) await answerCallback(env, update.callback_query.id);

  if (text.startsWith('/admin') || data === 'admin_refresh') {
    await sendAdminPanel(env, chatId);
    return json({ ok: true });
  }

  if (data === 'admin_push') {
    const sent = await sendPushToNotClicked(env);
    await sendMessage(env, chatId, `Дожим отправлен: ${sent} игрокам.`);
    await sendAdminPanel(env, chatId);
    return json({ ok: true });
  }

  if (data === 'admin_reset_help') {
    await sendMessage(env, chatId, 'Чтобы сбросить игрока, отправьте команду:\n/reset USER_ID\n\nНапример: /reset 123456789');
    return json({ ok: true });
  }

  if (text.startsWith('/reset')) {
    const userId = text.split(/\s+/)[1];
    if (!userId) {
      await sendMessage(env, chatId, 'Укажите ID игрока: /reset USER_ID');
      return json({ ok: true });
    }
    const player = await readPlayer(env, userId);
    player.locked = false;
    player.clickedPartner = false;
    player.gamesPlayed = 0;
    player.balance = 10;
    player.resetNonce = crypto.randomUUID();
    await writePlayer(env, userId, player);
    await sendMessage(env, chatId, `Игрок ${userId} сброшен. При следующем входе он начнёт с демо-счёта 10$ и сможет сыграть 3–5 раз.`);
    return json({ ok: true });
  }

  return json({ ok: true });
}

async function sendAdminPanel(env, chatId) {
  const players = await listPlayers(env);
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const total = players.length;
  const last24 = players.filter((p) => Date.parse(p.firstSeenAt || p.createdAt || 0) >= dayAgo || Date.parse(p.lastSeenAt || p.updatedAt || 0) >= dayAgo).length;
  const clicked = players.filter((p) => p.clickedPartner).length;
  const locked = players.filter((p) => p.locked && !p.clickedPartner).length;

  const text = [
    '📊 Админка Mines',
    '',
    `Всего игроков: ${total}`,
    `Игроков за 24ч: ${last24}`,
    `Перешли по ссылке: ${clicked}`,
    `Окно показано, но не перешли: ${locked}`,
    '',
    `Партнёрская ссылка: ${partnerUrl(env)}`
  ].join('\n');

  await sendMessage(env, chatId, text, {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'admin_refresh' }],
      [{ text: '📩 Дожим', callback_data: 'admin_push' }],
      [{ text: '♻️ Сброс игрока', callback_data: 'admin_reset_help' }]
    ]
  });
}

async function sendPushToNotClicked(env) {
  const players = await listPlayers(env);
  const targets = players.filter((p) => p.locked && !p.clickedPartner && /^\d+$/.test(String(p.userId)));
  let sent = 0;

  for (const player of targets) {
    const ok = await sendMessage(env, player.userId, 'Вы можете продолжить игру на сайте. Нажмите кнопку ниже.', {
      inline_keyboard: [[{ text: 'Продолжить игру', url: partnerUrl(env) }]]
    });
    if (ok) sent += 1;
  }

  return sent;
}

async function sendMessage(env, chatId, text, replyMarkup = null) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set.');
  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
  return response.ok;
}

async function answerCallback(env, callbackQueryId) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}

async function setWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' }, 500);
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (env.SETUP_SECRET && secret !== env.SETUP_SECRET) return json({ ok: false, error: 'Forbidden' }, 403);

  const webhookUrl = `${url.origin}/bot`;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ url: webhookUrl })
  });
  const data = await response.json();
  return json({ ok: response.ok, webhookUrl, telegram: data }, response.ok ? 200 : 500);
}
