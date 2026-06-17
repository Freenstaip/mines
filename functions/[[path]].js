const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  try {
    const isApiRoute = url.pathname === '/api/player' || url.pathname === '/api/track' || url.pathname === '/bot' || url.pathname === '/set-webhook';

    if (!isApiRoute) {
      return context.next();
    }

    await ensureSchema(env);

    if (url.pathname === '/api/player' && request.method === 'GET') return withCors(await getPlayer(request, env));
    if (url.pathname === '/api/track' && request.method === 'POST') return withCors(await trackEvent(request, env));
    if (url.pathname === '/bot' && request.method === 'POST') return await telegramWebhook(request, env);
    if (url.pathname === '/set-webhook' && request.method === 'GET') return await setWebhook(request, env);

    return withCors(json({ ok: false, error: 'Method not allowed' }, 405));
  } catch (error) {
    return withCors(json({ ok: false, error: error.message || 'Server error' }, 500));
  }
}

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

function getDb(env) {
  if (!env.DB) throw new Error('D1 database is not bound. Create Cloudflare D1 database and bind it as DB.');
  return env.DB;
}

async function ensureSchema(env) {
  const db = getDb(env);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 10,
      locked INTEGER NOT NULL DEFAULT 0,
      clicked_partner INTEGER NOT NULL DEFAULT 0,
      clicked_at INTEGER,
      reset_nonce TEXT NOT NULL DEFAULT '',
      trigger_after INTEGER NOT NULL DEFAULT 3,
      last_result TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_players_first_seen ON players(first_seen);
    CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
    CREATE INDEX IF NOT EXISTS idx_players_clicked_partner ON players(clicked_partner);
    CREATE INDEX IF NOT EXISTS idx_players_locked ON players(locked);
  `);
}

function partnerUrl(env) {
  return env.PARTNER_URL || 'https://example.com';
}

function adminIds(env) {
  return String(env.ADMIN_IDS || env.ADMIN_ID || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function randomTriggerAfter() {
  return Math.floor(Math.random() * 3) + 3;
}

function rowToPlayer(row) {
  if (!row) return null;
  return {
    userId: String(row.user_id),
    firstSeenAt: new Date(Number(row.first_seen)).toISOString(),
    lastSeenAt: new Date(Number(row.last_seen)).toISOString(),
    visits: Number(row.visits || 0),
    gamesPlayed: Number(row.games_played || 0),
    balance: Number(row.balance ?? 10),
    locked: Boolean(row.locked),
    clickedPartner: Boolean(row.clicked_partner),
    clickedAt: row.clicked_at ? new Date(Number(row.clicked_at)).toISOString() : null,
    resetNonce: row.reset_nonce || '',
    triggerAfter: Number(row.trigger_after || 3),
    lastResult: row.last_result || ''
  };
}

async function readPlayer(env, userId) {
  const db = getDb(env);
  const row = await db.prepare('SELECT * FROM players WHERE user_id = ?').bind(String(userId)).first();
  if (row) return rowToPlayer(row);

  const now = Date.now();
  const triggerAfter = randomTriggerAfter();
  await db.prepare(`
    INSERT INTO players (user_id, first_seen, last_seen, visits, games_played, balance, locked, clicked_partner, reset_nonce, trigger_after)
    VALUES (?, ?, ?, 0, 0, 10, 0, 0, '', ?)
  `).bind(String(userId), now, now, triggerAfter).run();

  return {
    userId: String(userId),
    firstSeenAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    visits: 0,
    gamesPlayed: 0,
    balance: 10,
    locked: false,
    clickedPartner: false,
    resetNonce: '',
    triggerAfter,
    lastResult: ''
  };
}

async function updatePlayer(env, userId, patch) {
  const current = await readPlayer(env, userId);
  const next = { ...current, ...patch, userId: String(userId) };
  const lastSeen = patch.lastSeenMs || Date.now();
  const clickedAt = next.clickedAtMs || (next.clickedPartner && !current.clickedPartner ? lastSeen : null);

  await getDb(env).prepare(`
    UPDATE players
    SET last_seen = ?,
        visits = ?,
        games_played = ?,
        balance = ?,
        locked = ?,
        clicked_partner = ?,
        clicked_at = COALESCE(?, clicked_at),
        reset_nonce = ?,
        trigger_after = ?,
        last_result = ?
    WHERE user_id = ?
  `).bind(
    lastSeen,
    Number(next.visits || 0),
    Number(next.gamesPlayed || 0),
    Number(next.balance ?? 10),
    next.locked ? 1 : 0,
    next.clickedPartner ? 1 : 0,
    clickedAt,
    next.resetNonce || '',
    Number(next.triggerAfter || randomTriggerAfter()),
    next.lastResult || '',
    String(userId)
  ).run();

  return next;
}

async function getPlayer(request, env) {
  const url = new URL(request.url);
  const userId = String(url.searchParams.get('userId') || request.headers.get('x-user-id') || 'demo-user');
  const player = await readPlayer(env, userId);
  const updated = await updatePlayer(env, userId, { visits: Number(player.visits || 0) + 1 });

  return json({
    ok: true,
    userId,
    locked: Boolean(updated.locked),
    clickedPartner: Boolean(updated.clickedPartner),
    resetNonce: updated.resetNonce || '',
    partnerUrl: partnerUrl(env)
  });
}

async function trackEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || request.headers.get('x-user-id') || 'demo-user');
  const player = await readPlayer(env, userId);
  const patch = { lastSeenMs: Date.now() };

  if (body.event === 'visit') {
    patch.visits = Number(player.visits || 0) + 1;
  }

  if (body.event === 'game_finished') {
    patch.gamesPlayed = Math.max(Number(player.gamesPlayed || 0), Number(body.gamesPlayed || body.state?.gamesPlayed || 0));
    patch.lastResult = body.result || player.lastResult || '';
    patch.balance = Number(body.balance ?? body.state?.balance ?? player.balance ?? 10);
  }

  if (body.event === 'locked') patch.locked = true;

  if (body.event === 'partner_click') {
    patch.locked = true;
    patch.clickedPartner = true;
    patch.clickedAtMs = Date.now();
    patch.balance = Number(body.balance ?? body.state?.balance ?? player.balance ?? 10);
    patch.gamesPlayed = Math.max(Number(player.gamesPlayed || 0), Number(body.gamesPlayed || body.state?.gamesPlayed || 0));
  }

  if (body.state) {
    patch.gamesPlayed ??= Math.max(Number(player.gamesPlayed || 0), Number(body.state.gamesPlayed || 0));
    patch.balance ??= Number(body.state.balance ?? player.balance ?? 10);
  }

  await updatePlayer(env, userId, patch);
  return json({ ok: true });
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
    await updatePlayer(env, userId, {
      locked: false,
      clickedPartner: false,
      gamesPlayed: 0,
      balance: 10,
      resetNonce: crypto.randomUUID(),
      triggerAfter: randomTriggerAfter(),
      lastResult: '',
      visits: Number(player.visits || 0)
    });

    await sendMessage(env, chatId, `Игрок ${userId} сброшен. При следующем входе он начнёт с демо-счёта 10$ и сможет сыграть 3–5 раз.`);
    return json({ ok: true });
  }

  return json({ ok: true });
}

async function sendAdminPanel(env, chatId) {
  const db = getDb(env);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const total = await db.prepare('SELECT COUNT(*) AS count FROM players').first('count');
  const last24 = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE first_seen >= ? OR last_seen >= ?').bind(dayAgo, dayAgo).first('count');
  const clicked = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE clicked_partner = 1').first('count');
  const locked = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE locked = 1 AND clicked_partner = 0').first('count');

  const text = [
    '📊 Админка Mines',
    '',
    `Всего игроков: ${Number(total || 0)}`,
    `Игроков за 24ч: ${Number(last24 || 0)}`,
    `Перешли по ссылке: ${Number(clicked || 0)}`,
    `Окно показано, но не перешли: ${Number(locked || 0)}`,
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
  const { results } = await getDb(env).prepare(`
    SELECT user_id FROM players
    WHERE locked = 1 AND clicked_partner = 0 AND user_id GLOB '[0-9]*'
  `).all();

  let sent = 0;
  for (const player of results || []) {
    const ok = await sendMessage(env, player.user_id, 'Вы можете продолжить игру на сайте. Нажмите кнопку ниже.', {
      inline_keyboard: [[{ text: 'Продолжить игру', url: partnerUrl(env) }]]
    });
    if (ok) sent += 1;
  }

  return sent;
}

async function sendMessage(env, chatId, text, replyMarkup = null) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN/BOT_TOKEN is not set.');
  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
  return response.ok;
}

async function answerCallback(env, callbackQueryId) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ callback_query_id: callbackQueryId })
  });
}

async function setWebhook(request, env) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN/BOT_TOKEN is not set' }, 500);
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (env.SETUP_SECRET && secret !== env.SETUP_SECRET) return json({ ok: false, error: 'Forbidden' }, 403);

  const webhookUrl = `${url.origin}/bot`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ url: webhookUrl })
  });
  const data = await response.json();
  return json({ ok: response.ok, webhookUrl, telegram: data }, response.ok ? 200 : 500);
}
