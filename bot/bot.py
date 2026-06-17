import os
import asyncio
import logging
from pathlib import Path

from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.exceptions import TelegramAPIError

try:
    from storage import init_db, upsert_user, mark_clicked, stats, not_clicked_users, reset_players, reset_player
except ImportError:
    from bot.storage import init_db, upsert_user, mark_clicked, stats, not_clicked_users, reset_players, reset_player

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

# Ищем .env в двух местах: корень проекта и папка bot/
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BASE_DIR / ".env", override=True)
load_dotenv(override=False)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("mines-bot")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
WEBAPP_URL = os.getenv("WEBAPP_URL", "").strip()
PARTNER_URL = os.getenv("PARTNER_URL", "").strip() or "https://partner-site.com"
ADMIN_IDS_RAW = os.getenv("ADMIN_IDS", "").strip()
ADMIN_IDS = {
    int(admin_id.strip())
    for admin_id in ADMIN_IDS_RAW.replace(";", ",").split(",")
    if admin_id.strip().isdigit()
}

if not BOT_TOKEN:
    raise RuntimeError(
        "Не найден BOT_TOKEN. Создайте файл .env в корне проекта или в папке bot/."
    )

bot = Bot(BOT_TOKEN)
dp = Dispatcher()


def is_admin(user_id: int) -> bool:
    # Если ADMIN_IDS пустой, /admin доступен всем — чтобы можно было проверить запуск.
    return not ADMIN_IDS or user_id in ADMIN_IDS


def game_keyboard() -> InlineKeyboardMarkup | None:
    if not WEBAPP_URL:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Start", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])


def partner_url_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Перейти на сайт", url=PARTNER_URL)]
    ])


def partner_callback_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Продолжить игру", callback_data="partner:go")]
    ])


def admin_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 Обновить", callback_data="admin:refresh")],
        [InlineKeyboardButton(text="📣 Дожим", callback_data="admin:push")],
        [InlineKeyboardButton(text="♻️ Сброс игроков", callback_data="admin:reset_all")],
    ])


def admin_text() -> str:
    data = stats()
    admin_mode = "ограничен" if ADMIN_IDS else "тестовый, доступен всем"
    return (
        "📊 Статистика Mines\n\n"
        f"Всего игроков: {data['total']}\n"
        f"Игроков за 24ч: {data['users_24h']}\n"
        f"Перешли по ссылке: {data['clicked']}\n"
        f"Не перешли по ссылке: {data['not_clicked']}\n\n"
        f"Режим админки: {admin_mode}"
    )


async def send_admin_panel(message: types.Message):
    if not is_admin(message.from_user.id):
        await message.answer(
            "⛔️ У вас нет доступа к админке.\n\n"
            f"Ваш Telegram ID: {message.from_user.id}\n"
            "Добавьте его в ADMIN_IDS в .env и перезапустите бота.\n\n"
            f"Сейчас ADMIN_IDS={ADMIN_IDS_RAW or '(пусто)'}"
        )
        return

    upsert_user(
        message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    await message.answer(admin_text(), reply_markup=admin_keyboard())


@dp.message(CommandStart())
async def start(message: types.Message):
    upsert_user(
        message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    text = "👋 Добро пожаловать в Mines!"
    keyboard = game_keyboard()

    if keyboard:
        text += "\n\nНажмите Start, чтобы начать демо-игру."
        await message.answer(text, reply_markup=keyboard)
    else:
        text += "\n\nWEBAPP_URL не указан в .env, поэтому кнопка игры пока не создана."
        await message.answer(text)


@dp.message(Command("ping"))
async def ping(message: types.Message):
    me = await bot.get_me()
    await message.answer(
        "✅ Бот работает.\n"
        f"Бот: @{me.username}\n"
        f"Ваш Telegram ID: {message.from_user.id}\n"
        f"ADMIN_IDS из .env: {ADMIN_IDS_RAW or '(пусто — доступ всем)'}\n"
        f"WEBAPP_URL: {WEBAPP_URL or '(не указан)'}"
    )


@dp.message(Command("admin"))
async def admin_panel_command(message: types.Message):
    await send_admin_panel(message)


# Дополнительный fallback: если Telegram/клиент отправил текст не как BotCommand.
@dp.message(F.text.lower().in_({"/admin", "admin", "админ"}))
async def admin_panel_text(message: types.Message):
    await send_admin_panel(message)


@dp.callback_query(F.data == "partner:go")
async def partner_go(callback: types.CallbackQuery):
    mark_clicked(callback.from_user.id)
    await callback.message.answer(
        "Игру можно продолжить на сайте партнёра.",
        reply_markup=partner_url_keyboard(),
    )
    await callback.answer("Ссылка отправлена")


@dp.callback_query(F.data == "admin:refresh")
async def refresh_admin(callback: types.CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.message.edit_text(admin_text(), reply_markup=admin_keyboard())
    await callback.answer("Обновлено")


@dp.callback_query(F.data == "admin:push")
async def push_not_clicked(callback: types.CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("Нет доступа", show_alert=True)
        return

    sent = 0
    failed = 0
    for user_id in not_clicked_users():
        if user_id == callback.from_user.id:
            continue
        try:
            await bot.send_message(
                user_id,
                "🎮 Игру можно продолжить на сайте. Нажмите кнопку ниже.",
                reply_markup=partner_callback_keyboard(),
            )
            sent += 1
            await asyncio.sleep(0.05)
        except Exception as exc:
            logger.warning("Не удалось отправить сообщение user_id=%s: %s", user_id, exc)
            failed += 1

    await callback.message.edit_text(
        f"📣 Дожим завершён.\n\nОтправлено: {sent}\nНе отправлено: {failed}\n\n" + admin_text(),
        reply_markup=admin_keyboard(),
    )
    await callback.answer("Рассылка завершена")


@dp.callback_query(F.data == "admin:reset_all")
async def reset_all(callback: types.CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer("Нет доступа", show_alert=True)
        return
    reset_players()
    await callback.message.edit_text(
        "♻️ Игроки сброшены в статистике бота.\n\n" + admin_text(),
        reply_markup=admin_keyboard(),
    )
    await callback.answer("Игроки сброшены")


@dp.message(Command("reset_player"))
async def reset_one_player(message: types.Message):
    if not is_admin(message.from_user.id):
        await message.answer("⛔️ Нет доступа")
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].isdigit():
        await message.answer("Использование: /reset_player 123456789")
        return

    reset_player(int(parts[1]))
    await message.answer("Игрок сброшен в статистике бота.")


async def main():
    init_db()
    me = await bot.get_me()

    logger.info("Бот запускается: @%s id=%s", me.username, me.id)
    logger.info("WEBAPP_URL=%s", WEBAPP_URL or "не указан")
    logger.info("PARTNER_URL=%s", PARTNER_URL)
    logger.info("ADMIN_IDS=%s", sorted(ADMIN_IDS) if ADMIN_IDS else "пусто, /admin доступен всем")

    # Критично: если раньше на боте был webhook, polling не будет получать /admin.
    # Поэтому сбрасываем webhook перед polling.
    try:
        await bot.delete_webhook(drop_pending_updates=False)
        logger.info("Webhook сброшен, polling может принимать команды")
    except TelegramAPIError as exc:
        logger.warning("Не удалось сбросить webhook: %s", exc)

    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == "__main__":
    asyncio.run(main())
