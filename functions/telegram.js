import {
  json,
  tgApi,
  answerCallback,
  gameKeyboard,
  partnerKeyboard,
  adminKeyboard,
  isAdmin,
  upsertUser,
  listUsers,
  statsText,
  resetPlayers,
} from './_utils.js';

function partnerGoUrl(request, userId) {
  const origin = new URL(request.url).origin;
  return `${origin}/go?uid=${encodeURIComponent(userId)}`;
}

async function sendMessage(env, chatId, text, replyMarkup = undefined) {
  return tgApi(env, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

async function editMessage(env, chatId, messageId, text, replyMarkup = undefined) {
  return tgApi(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });
}

async function handleMessage(update, env, request) {
  const message = update.message;
  if (!message || !message.from || !message.chat) return;

  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim().toLowerCase();

  await upsertUser(env, {
    user_id: userId,
    username: message.from.username || '',
    first_name: message.from.first_name || '',
    reason: 'telegram_message',
  });

  if (text.startsWith('/start')) {
    await sendMessage(
      env,
      chatId,
      '👋 Добро пожаловать в Mines!\n\nНажмите Start, чтобы открыть демо-игру.',
      gameKeyboard(env, request),
    );
    return;
  }

  if (text.startsWith('/ping')) {
    await sendMessage(
      env,
      chatId,
      `✅ Бот работает через Cloudflare Pages Functions.\nВаш Telegram ID: ${userId}`,
    );
    return;
  }

  if (text.startsWith('/admin') || text === 'admin' || text === 'админ') {
    if (!isAdmin(env, userId)) {
      await sendMessage(env, chatId, `⛔️ Нет доступа.\nВаш Telegram ID: ${userId}\nДобавьте его в ADMIN_IDS в Cloudflare Pages → Settings → Environment variables.`);
      return;
    }

    await sendMessage(env, chatId, await statsText(env), adminKeyboard());
    return;
  }
}

async function handleCallback(update, env, request) {
  const callback = update.callback_query;
  if (!callback || !callback.from || !callback.message) return;

  const userId = callback.from.id;
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const data = String(callback.data || '');

  if (!isAdmin(env, userId) && data.startsWith('admin:')) {
    await answerCallback(env, callback.id, 'Нет доступа');
    return;
  }

  if (data === 'admin:refresh') {
    await editMessage(env, chatId, messageId, await statsText(env), adminKeyboard());
    await answerCallback(env, callback.id, 'Обновлено');
    return;
  }

  if (data === 'admin:reset_all') {
    const count = await resetPlayers(env);
    await editMessage(env, chatId, messageId, `♻️ Игроки сброшены: ${count}\n\n${await statsText(env)}`, adminKeyboard());
    await answerCallback(env, callback.id, 'Сброшено');
    return;
  }

  if (data === 'admin:push') {
    const users = await listUsers(env);
    let sent = 0;
    let failed = 0;

    for (const user of users.filter((u) => !u.clicked)) {
      if (Number(user.user_id) === Number(userId)) continue;
      try {
        await sendMessage(
          env,
          user.user_id,
          '🎮 Игру можно продолжить на сайте. Нажмите кнопку ниже.',
          partnerKeyboard(partnerGoUrl(request, user.user_id)),
        );
        sent += 1;
      } catch (_) {
        failed += 1;
      }
    }

    await editMessage(env, chatId, messageId, `📣 Дожим завершён.\n\nОтправлено: ${sent}\nНе отправлено: ${failed}\n\n${await statsText(env)}`, adminKeyboard());
    await answerCallback(env, callback.id, 'Рассылка завершена');
  }
}

export async function onRequestGet() {
  return json({ ok: true, message: 'Telegram webhook endpoint is ready. Use POST from Telegram.' });
}

export async function onRequestPost({ request, env }) {
  try {
    const update = await request.json();

    if (update.message) await handleMessage(update, env, request);
    if (update.callback_query) await handleCallback(update, env, request);

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) }, 500);
  }
}
