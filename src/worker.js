const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  try {
    const isApiRoute = url.pathname === '/api/player' || url.pathname === '/api/track' || url.pathname === '/bot' || url.pathname === '/set-webhook';

    if (!isApiRoute) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
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
};

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,cache-control,x-user-id,x-tg-user-present,x-tg-username,x-tg-first-name,x-tg-last-name,x-tg-language-code'
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

  // Важно: D1 иногда ругается на многострочный SQL при автодеплое через dashboard.
  // Поэтому схема записана одной строкой.
  await db.prepare("CREATE TABLE IF NOT EXISTS players (user_id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 0, games_played INTEGER NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 10, locked INTEGER NOT NULL DEFAULT 0, clicked_partner INTEGER NOT NULL DEFAULT 0, clicked_at INTEGER, reset_nonce TEXT NOT NULL DEFAULT '', trigger_after INTEGER NOT NULL DEFAULT 3, last_result TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_players_first_seen ON players(first_seen)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_players_clicked_partner ON players(clicked_partner)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_players_locked ON players(locked)").run();

  // Безопасные миграции для уже созданной базы: добавляем данные Telegram-профиля.
  await addColumnIfMissing(db, 'players', 'username', 'TEXT');
  await addColumnIfMissing(db, 'players', 'first_name', 'TEXT');
  await addColumnIfMissing(db, 'players', 'last_name', 'TEXT');
  await addColumnIfMissing(db, 'players', 'language_code', 'TEXT');
  await addColumnIfMissing(db, 'players', 'direct_partner_click', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'players', 'direct_partner_clicked_at', 'INTEGER');
}

async function addColumnIfMissing(db, table, column, type) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = (results || []).some((row) => row.name === column);
  if (!exists) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
}

function partnerUrl(env) {
  return env.PARTNER_URL || 'https://example.com';
}

function gameUrl(env) {
  return env.GAME_URL || env.WEBAPP_URL || env.PUBLIC_GAME_URL || env.PUBLIC_URL || 'https://minesdemo.site';
}

function adminIds(env) {
  return String(env.ADMIN_IDS || env.ADMIN_ID || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function randomTriggerAfter() {
  return Math.floor(Math.random() * 3) + 3;
}

function normalizeUserId(value) {
  const id = String(value || '').trim();
  return id || 'demo-user';
}

function parseTelegramUserFromInitData(initData) {
  try {
    if (!initData) return null;
    const params = new URLSearchParams(String(initData));
    const rawUser = params.get('user');
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeTelegramProfile(user = {}) {
  return {
    username: user.username || '',
    firstName: user.first_name || user.firstName || '',
    lastName: user.last_name || user.lastName || '',
    languageCode: user.language_code || user.languageCode || ''
  };
}

function requestTelegramProfile(request) {
  const url = new URL(request.url);
  return {
    username: url.searchParams.get('username') || request.headers.get('x-tg-username') || '',
    firstName: url.searchParams.get('firstName') || request.headers.get('x-tg-first-name') || '',
    lastName: url.searchParams.get('lastName') || request.headers.get('x-tg-last-name') || '',
    languageCode: url.searchParams.get('languageCode') || request.headers.get('x-tg-language-code') || ''
  };
}

async function getGlobalResetNonce(env) {
  const row = await getDb(env).prepare("SELECT value FROM app_meta WHERE key = 'global_reset_nonce'").first();
  return row?.value || '';
}

async function setGlobalResetNonce(env, nonce) {
  await getDb(env).prepare("INSERT INTO app_meta (key, value) VALUES ('global_reset_nonce', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(nonce).run();
  return nonce;
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
    lastResult: row.last_result || '',
    username: row.username || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    languageCode: row.language_code || '',
    directPartnerClick: Boolean(row.direct_partner_click),
    directPartnerClickedAt: row.direct_partner_clicked_at ? new Date(Number(row.direct_partner_clicked_at)).toISOString() : null
  };
}

async function readPlayer(env, userId) {
  const db = getDb(env);
  const row = await db.prepare('SELECT * FROM players WHERE user_id = ?').bind(String(userId)).first();
  if (row) return rowToPlayer(row);

  const now = Date.now();
  const triggerAfter = randomTriggerAfter();
  const resetNonce = await getGlobalResetNonce(env);
  await db.prepare(`
    INSERT INTO players (user_id, first_seen, last_seen, visits, games_played, balance, locked, clicked_partner, reset_nonce, trigger_after, username, first_name, last_name, language_code, direct_partner_click)
    VALUES (?, ?, ?, 0, 0, 10, 0, 0, ?, ?, '', '', '', '', 0)
  `).bind(String(userId), now, now, resetNonce, triggerAfter).run();

  return {
    userId: String(userId),
    firstSeenAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    visits: 0,
    gamesPlayed: 0,
    balance: 10,
    locked: false,
    clickedPartner: false,
    resetNonce,
    triggerAfter,
    lastResult: '',
    username: '',
    firstName: '',
    lastName: '',
    languageCode: '',
    directPartnerClick: false,
    directPartnerClickedAt: null
  };
}

async function updatePlayer(env, userId, patch) {
  const current = await readPlayer(env, userId);
  const next = { ...current, ...patch, userId: String(userId) };
  const lastSeen = patch.lastSeenMs || Date.now();
  const clickedAt = next.clickedAtMs || (next.clickedPartner && !current.clickedPartner ? lastSeen : null);
  const directClickedAt = next.directPartnerClickedAtMs || (next.directPartnerClick && !current.directPartnerClick ? lastSeen : null);

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
        last_result = ?,
        username = COALESCE(NULLIF(?, ''), username),
        first_name = COALESCE(NULLIF(?, ''), first_name),
        last_name = COALESCE(NULLIF(?, ''), last_name),
        language_code = COALESCE(NULLIF(?, ''), language_code),
        direct_partner_click = ?,
        direct_partner_clicked_at = COALESCE(?, direct_partner_clicked_at)
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
    next.username || '',
    next.firstName || '',
    next.lastName || '',
    next.languageCode || '',
    next.directPartnerClick ? 1 : 0,
    directClickedAt,
    String(userId)
  ).run();

  return next;
}

async function getPlayer(request, env) {
  const url = new URL(request.url);
  const userId = normalizeUserId(url.searchParams.get('userId') || request.headers.get('x-user-id'));
  const player = await readPlayer(env, userId);
  const profile = requestTelegramProfile(request);
  const updated = await updatePlayer(env, userId, {
    visits: Number(player.visits || 0) + 1,
    username: profile.username || player.username || '',
    firstName: profile.firstName || player.firstName || '',
    lastName: profile.lastName || player.lastName || '',
    languageCode: profile.languageCode || player.languageCode || ''
  });

  const shouldLock = Number(updated.gamesPlayed || 0) >= Number(updated.triggerAfter || 3) || Number(updated.balance || 0) <= 0;
  const finalPlayer = shouldLock && !updated.locked
    ? await updatePlayer(env, userId, { locked: true })
    : updated;

  return json({
    ok: true,
    userId,
    locked: Boolean(finalPlayer.locked),
    clickedPartner: Boolean(finalPlayer.clickedPartner),
    resetNonce: finalPlayer.resetNonce || '',
    triggerAfter: Number(finalPlayer.triggerAfter || 3),
    gamesPlayed: Number(finalPlayer.gamesPlayed || 0),
    balance: Number(finalPlayer.balance ?? 10),
    partnerUrl: partnerUrl(env),
    gameUrl: gameUrl(env),
    isTelegramUser: /^\d+$/.test(String(userId))
  });
}
async function trackEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const initDataUser = parseTelegramUserFromInitData(body.initData || '');
  const effectiveUser = body.user?.id ? body.user : initDataUser;
  const userId = normalizeUserId(effectiveUser?.id || body.userId || request.headers.get('x-user-id'));
  const player = await readPlayer(env, userId);
  const patch = { lastSeenMs: Date.now() };
  const bodyProfile = normalizeTelegramProfile(effectiveUser || {});
  if (effectiveUser) {
    patch.username = bodyProfile.username || player.username || '';
    patch.firstName = bodyProfile.firstName || player.firstName || '';
    patch.lastName = bodyProfile.lastName || player.lastName || '';
    patch.languageCode = bodyProfile.languageCode || player.languageCode || '';
  }

  if (body.event === 'visit') {
    patch.visits = Number(player.visits || 0) + 1;
  }

  const stateMatchesReset = !body.state?.resetNonce || body.state.resetNonce === player.resetNonce;

  if (body.event === 'game_finished') {
    patch.gamesPlayed = Math.max(Number(player.gamesPlayed || 0), Number(body.gamesPlayed || (stateMatchesReset ? body.state?.gamesPlayed : 0) || 0));
    patch.lastResult = body.result || player.lastResult || '';
    patch.balance = Number(body.balance ?? (stateMatchesReset ? body.state?.balance : undefined) ?? player.balance ?? 10);
  }

  if (body.event === 'locked') patch.locked = true;

  if (body.event === 'partner_click' || body.event === 'direct_partner_click') {
    patch.locked = true;
    patch.clickedPartner = true;
    patch.clickedAtMs = Date.now();
    patch.balance = Number(body.balance ?? (stateMatchesReset ? body.state?.balance : undefined) ?? player.balance ?? 10);
    patch.gamesPlayed = Math.max(Number(player.gamesPlayed || 0), Number(body.gamesPlayed || (stateMatchesReset ? body.state?.gamesPlayed : 0) || 0));
    if (body.event === 'direct_partner_click') {
      patch.directPartnerClick = true;
      patch.directPartnerClickedAtMs = Date.now();
    }
  }

  if (body.state && stateMatchesReset) {
    patch.gamesPlayed ??= Math.max(Number(player.gamesPlayed || 0), Number(body.state.gamesPlayed || 0));
    patch.balance ??= Number(body.state.balance ?? player.balance ?? 10);
  }

  const updated = await updatePlayer(env, userId, patch);

  if (body.event === 'game_finished') {
    const shouldLockByGames = Number(updated.gamesPlayed || 0) >= Number(updated.triggerAfter || 3);
    const shouldLockByBalance = Number(updated.balance || 0) <= 0 && Number(updated.gamesPlayed || 0) <= 5;
    if (shouldLockByGames || shouldLockByBalance) {
      await updatePlayer(env, userId, { locked: true, lastResult: updated.lastResult || '' });
    }
  }

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

  if (update.callback_query?.id) await answerCallback(env, update.callback_query.id);

  if (text.startsWith('/start')) {
    await saveTelegramProfile(env, from);
    await sendWelcomeMessage(env, chatId);
    return json({ ok: true });
  }

  if (!isAdmin(env, from.id)) {
    if (text.startsWith('/admin')) await sendMessage(env, chatId, 'У вас нет доступа к админке.');
    return json({ ok: true });
  }


  if (text.startsWith('/admin') || data === 'admin_refresh') {
    await sendAdminPanel(env, chatId);
    return json({ ok: true });
  }

  if (text.startsWith('/players') || data === 'admin_players') {
    await sendPlayersList(env, chatId);
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

  if (data === 'admin_reset_all_confirm' || text.startsWith('/reset_all')) {
    await sendMessage(env, chatId, '⚠️ Подтвердите полный сброс статистики. Будут удалены все игроки, переходы, балансы, лимиты игр и блокировки. После следующего входа игроки начнут заново.', {
      inline_keyboard: [
        [{ text: '✅ Да, сбросить всё', callback_data: 'admin_reset_all_execute' }],
        [{ text: '❌ Отмена', callback_data: 'admin_refresh' }]
      ]
    });
    return json({ ok: true });
  }

  if (data === 'admin_reset_all_execute') {
    const deleted = await resetAllStats(env);
    await sendMessage(env, chatId, `✅ Вся статистика сброшена. Удалено игроков: ${deleted}.`);
    await sendAdminPanel(env, chatId);
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
      directPartnerClick: false,
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

async function saveTelegramProfile(env, from) {
  if (!from?.id) return;
  const player = await readPlayer(env, from.id);
  await updatePlayer(env, from.id, {
    username: from.username || player.username || '',
    firstName: from.first_name || player.firstName || '',
    lastName: from.last_name || player.lastName || '',
    languageCode: from.language_code || player.languageCode || ''
  });
}

async function sendWelcomeMessage(env, chatId) {
  await sendMessage(env, chatId, 'Welcome to Mines! You have been credited with $10.', {
    inline_keyboard: [[{ text: '🎮 START', web_app: { url: gameUrl(env) } }]]
  });
}

async function sendAdminPanel(env, chatId) {
  const db = getDb(env);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const total = await db.prepare('SELECT COUNT(*) AS count FROM players').first('count');
  const last24 = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE first_seen >= ? OR last_seen >= ?').bind(dayAgo, dayAgo).first('count');
  const clicked = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE clicked_partner = 1').first('count');
  const directClicked = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE direct_partner_click = 1').first('count');
  const locked = await db.prepare('SELECT COUNT(*) AS count FROM players WHERE locked = 1 AND clicked_partner = 0').first('count');

  const text = [
    '📊 Админка Mines',
    '',
    `Всего игроков: ${Number(total || 0)}`,
    `Игроков за 24ч: ${Number(last24 || 0)}`,
    `Перешли по ссылке: ${Number(clicked || 0)}`,
    `Сразу перешли из игры: ${Number(directClicked || 0)}`,
    `Окно показано, но не перешли: ${Number(locked || 0)}`,
    '',
    `Партнёрская ссылка: ${partnerUrl(env)}`
  ].join('\n');

  await sendMessage(env, chatId, text, {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'admin_refresh' }],
      [{ text: '👥 Игроки / ID', callback_data: 'admin_players' }],
      [{ text: '📩 Дожим', callback_data: 'admin_push' }],
      [{ text: '♻️ Сброс игрока', callback_data: 'admin_reset_help' }],
      [{ text: '🧹 Сбросить всю статистику', callback_data: 'admin_reset_all_confirm' }]
    ]
  });
}

async function sendPlayersList(env, chatId) {
  const { results } = await getDb(env).prepare(`
    SELECT user_id, username, first_name, last_name, games_played, balance, locked, clicked_partner, direct_partner_click, last_seen
    FROM players
    ORDER BY last_seen DESC
    LIMIT 20
  `).all();

  if (!results || results.length === 0) {
    await sendMessage(env, chatId, 'Игроков пока нет.');
    return;
  }

  const lines = ['👥 Последние 20 игроков', ''];
  for (const p of results) {
    const name = formatPlayerName(p);
    const status = Number(p.direct_partner_click) ? 'сразу перешёл' : (Number(p.clicked_partner) ? 'перешёл' : (Number(p.locked) ? 'окно показано' : 'играет'));
    lines.push(`${name}`);
    lines.push(`ID: ${p.user_id}`);
    lines.push(`Игр: ${Number(p.games_played || 0)} | Баланс: $${Number(p.balance ?? 10).toFixed(2)} | ${status}`);
    lines.push(`Сброс: /reset ${p.user_id}`);
    lines.push('');
  }

  await sendMessage(env, chatId, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '🔄 Обновить список', callback_data: 'admin_players' }],
      [{ text: '⬅️ Назад в админку', callback_data: 'admin_refresh' }]
    ]
  });
}

function formatPlayerName(p) {
  const username = p.username ? `@${p.username}` : '';
  const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return username || fullName || `Игрок ${p.user_id}`;
}

async function resetAllStats(env) {
  const db = getDb(env);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM players').first('count');
  const nonce = crypto.randomUUID();
  await db.prepare('DELETE FROM players').run();
  await setGlobalResetNonce(env, nonce);
  return Number(count || 0);
}

async function sendPushToNotClicked(env) {
  const { results } = await getDb(env).prepare(`
    SELECT user_id FROM players
    WHERE clicked_partner = 0 AND user_id GLOB '[0-9]*'
  `).all();

  let sent = 0;
  for (const player of results || []) {
    const ok = await sendMessage(env, player.user_id, '‼️You forgot your winnings, hurry to collect them before they disappear.‼️', {
      inline_keyboard: [[{ text: 'CLAIM YOUR WINNINGS ✅', url: partnerUrl(env) }]]
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
