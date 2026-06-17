const json = (body, status = 200) => Response.json(body, { status });

async function tg(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

function isAdmin(env, id) {
  return String(env.ADMIN_IDS || '').split(',').map(x => x.trim()).includes(String(id));
}

async function listUsers(env) {
  const listed = await env.PLAYERS.list({ prefix: 'user:' });
  const users = [];
  for (const key of listed.keys) {
    const user = await env.PLAYERS.get(key.name, 'json');
    if (user) users.push(user);
  }
  return users;
}

async function adminText(env) {
  const users = await listUsers(env);
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const total = users.length;
  const last24 = users.filter(u => Number(u.lastSeen || 0) >= dayAgo).length;
  const clicked = users.filter(u => u.clicked).length;
  const locked = users.filter(u => u.locked).length;
  const notClickedLocked = users.filter(u => u.locked && !u.clicked).length;

  return [
    '📊 Админка Mines',
    '',
    `Всего игроков: ${total}`,
    `Игроков за 24ч: ${last24}`,
    `Перешли по ссылке: ${clicked}`,
    `С окном перехода: ${locked}`,
    `Для дожима: ${notClickedLocked}`,
    '',
    'Для сброса одного игрока: /reset TELEGRAM_ID'
  ].join('\n');
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'admin:refresh' }],
      [{ text: '📣 Дожим', callback_data: 'admin:push' }],
      [{ text: '♻️ Сбросить заблокированных', callback_data: 'admin:reset_locked' }]
    ]
  };
}

async function sendAdmin(env, chatId) {
  return tg(env, 'sendMessage', { chat_id: chatId, text: await adminText(env), reply_markup: adminKeyboard() });
}

async function pushNotClicked(env) {
  const users = await listUsers(env);
  const targets = users.filter(u => u.locked && !u.clicked);
  let sent = 0;

  for (const user of targets) {
    const result = await tg(env, 'sendMessage', {
      chat_id: user.userId,
      text: 'Игру можно продолжить на сайте партнёра. Нажмите кнопку ниже.',
      reply_markup: { inline_keyboard: [[{ text: 'Продолжить игру', url: env.PARTNER_URL }]] }
    });
    if (result.ok) sent += 1;
  }

  return sent;
}

async function resetUser(env, userId) {
  const key = `user:${userId}`;
  const user = await env.PLAYERS.get(key, 'json') || { userId };
  user.locked = false;
  user.clicked = false;
  user.lockReason = '';
  user.gamesPlayed = 0;
  user.resetAt = Date.now();
  user.lastSeen = Date.now();
  await env.PLAYERS.put(key, JSON.stringify(user));
}

export async function onRequestPost({ request, env }) {
  const update = await request.json().catch(() => ({}));
  const message = update.message;
  const callback = update.callback_query;

  if (message?.text) {
    const chatId = message.chat.id;
    const fromId = message.from.id;
    const text = message.text.trim();

    if (text === '/start') {
      await env.PLAYERS.put(`user:${fromId}`, JSON.stringify({
        userId: String(fromId), firstSeen: Date.now(), lastSeen: Date.now(), gamesPlayed: 0, locked: false, clicked: false, resetAt: 0
      }));
      await tg(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Нажмите кнопку ниже, чтобы открыть демо-игру.',
        reply_markup: { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: env.WEBAPP_URL } }]] }
      });
      return json({ ok: true });
    }

    if (text === '/admin') {
      if (!isAdmin(env, fromId)) return json({ ok: true });
      await sendAdmin(env, chatId);
      return json({ ok: true });
    }

    if (text.startsWith('/reset ')) {
      if (!isAdmin(env, fromId)) return json({ ok: true });
      const targetId = text.split(/\s+/)[1];
      await resetUser(env, targetId);
      await tg(env, 'sendMessage', { chat_id: chatId, text: `Игрок ${targetId} сброшен.` });
      return json({ ok: true });
    }
  }

  if (callback) {
    const chatId = callback.message.chat.id;
    const fromId = callback.from.id;
    if (!isAdmin(env, fromId)) return json({ ok: true });

    if (callback.data === 'admin:refresh') {
      await tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: callback.message.message_id,
        text: await adminText(env),
        reply_markup: adminKeyboard()
      });
    }

    if (callback.data === 'admin:push') {
      const sent = await pushNotClicked(env);
      await tg(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: `Отправлено: ${sent}` });
      await sendAdmin(env, chatId);
    }

    if (callback.data === 'admin:reset_locked') {
      const users = await listUsers(env);
      const targets = users.filter(u => u.locked);
      for (const user of targets) await resetUser(env, user.userId);
      await tg(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: `Сброшено: ${targets.length}` });
      await sendAdmin(env, chatId);
    }
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return new Response('Telegram bot webhook is active');
}
