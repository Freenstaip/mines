import os
import json
import asyncio
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp

from storage import (
    init_db,
    upsert_user,
    mark_game_event,
    mark_blocked,
    mark_clicked,
    stats,
    not_clicked_users,
    reset_players,
    reset_player,
)

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-domain.pages.dev")
PARTNER_URL = os.getenv("PARTNER_URL", "https://partner-site.com")
ADMIN_IDS = {
    int(admin_id.strip())
    for admin_id in os.getenv("ADMIN_IDS", "").split(",")
    if admin_id.strip().isdigit()
}

if not BOT_TOKEN:
    raise RuntimeError("Укажите BOT_TOKEN в .env")

bot = Bot(BOT_TOKEN)
dp = Dispatcher()


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


def game_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Start", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])


def partner_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Продолжить игру", url=PARTNER_URL)]
    ])


def admin_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 Обновить", callback_data="admin:refresh")],
        [InlineKeyboardButton(text="📣 Дожим", callback_data="admin:push")],
        [InlineKeyboardButton(text="♻️ Сброс игроков", callback_data="admin:reset_all")],
    ])


def admin_text() -> str:
    data = stats()
    return (
        "📊 Статистика Mines\n\n"
        f"Всего игроков: {data['total']}\n"
        f"Игроков за 24ч: {data['users_24h']}\n"
        f"Перешли по ссылке: {data['clicked']}\n"
        f"Заблокированы popup-ом: {data['blocked']}\n"
        f"Не перешли по ссылке: {data['not_clicked']}"
    )


@dp.message(CommandStart())
async def start(message: types.Message):
    upsert_user(
        message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    await message.answer(
        "👋 Добро пожаловать в Mines!\n\nНажмите Start, чтобы начать демо-игру.",
        reply_markup=game_keyboard(),
    )


@dp.message(Command("admin"))
async def admin_panel(message: types.Message):
    if not is_admin(message.from_user.id):
        return

    await message.answer(admin_text(), reply_markup=admin_keyboard())


@dp.message(F.web_app_data)
async def webapp_event(message: types.Message):
    try:
        data = json.loads(message.web_app_data.data)
    except (json.JSONDecodeError, TypeError):
        return

    user_id = message.from_user.id
    action = data.get("action")
    games_count = int(data.get("games_count") or 0)
    reason = data.get("reason")

    upsert_user(
        user_id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    if action == "player_open":
        mark_game_event(user_id, games_count=games_count, reason="player_open")
    elif action == "game_finished":
        mark_game_event(user_id, games_count=games_count, reason=reason)
    elif action == "partner_popup":
        mark_blocked(user_id, games_count=games_count, reason=reason)
    elif action == "partner_click":
        mark_clicked(user_id)


@dp.callback_query(F.data == "admin:refresh")
async def refresh_admin(callback: types.CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer()
        return

    await callback.message.edit_text(admin_text(), reply_markup=admin_keyboard())
    await callback.answer("Обновлено")


@dp.callback_query(F.data == "admin:push")
async def push_not_clicked(callback: types.CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer()
        return

    sent = 0
    failed = 0

    for user_id in not_clicked_users():
        try:
            await bot.send_message(
                user_id,
                "🎮 Игру можно продолжить на сайте. Нажмите кнопку ниже.",
                reply_markup=partner_keyboard(),
            )
            sent += 1
            await asyncio.sleep(0.05)
        except Exception:
            failed += 1

    await callback.message.edit_text(
        f"📣 Дожим завершён.\n\nОтправлено: {sent}\nНе отправлено: {failed}\n\n" + admin_text(),
        reply_markup=admin_keyboard(),
    )
    await callback.answer("Рассылка завершена")


@dp.callback_query(F.data == "admin:reset_all")
async def reset_all(callback: types.CallbackQuery):
    if not is_admin(callback.from_user.id):
        await callback.answer()
        return

    reset_players()
    await callback.message.edit_text(
        "♻️ Все игроки сброшены в статистике бота.\n\n"
        "Важно: локальный прогресс в Mini App сбросится у пользователя только после очистки данных Telegram WebView или если добавить серверную проверку статуса.\n\n"
        + admin_text(),
        reply_markup=admin_keyboard(),
    )
    await callback.answer("Игроки сброшены")


@dp.message(Command("reset_player"))
async def reset_one_player(message: types.Message):
    if not is_admin(message.from_user.id):
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].isdigit():
        await message.answer("Использование: /reset_player 123456789")
        return

    reset_player(int(parts[1]))
    await message.answer("Игрок сброшен в статистике бота.")


async def main():
    init_db()
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Mini App", web_app=WebAppInfo(url=WEBAPP_URL))
    )
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
