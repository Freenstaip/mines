import os
import asyncio
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command, CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp

from storage import init_db, upsert_user, mark_clicked, stats, not_clicked_users, reset_players, reset_player

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
    # Если ADMIN_IDS не задан, /admin временно доступен всем.
    # Для продакшена обязательно укажите ADMIN_IDS в .env.
    return not ADMIN_IDS or user_id in ADMIN_IDS


def game_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Start", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])


def partner_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Продолжить игру", callback_data="partner:go")]
    ])


def partner_url_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Перейти на сайт", url=PARTNER_URL)]
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


@dp.callback_query(F.data == "partner:go")
async def partner_go(callback: types.CallbackQuery):
    mark_clicked(callback.from_user.id)
    await callback.message.answer(
        "Игру можно продолжить на сайте партнёра.",
        reply_markup=partner_url_keyboard(),
    )
    await callback.answer("Ссылка отправлена")


@dp.message(Command("admin"))
async def admin_panel(message: types.Message):
    if not is_admin(message.from_user.id):
        await message.answer(
            "⛔️ У вас нет доступа к админке.\n\n"
            f"Ваш Telegram ID: {message.from_user.id}\n"
            "Добавьте его в ADMIN_IDS в .env и перезапустите бота."
        )
        return

    upsert_user(
        message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    await message.answer(admin_text(), reply_markup=admin_keyboard())


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
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Mini App", web_app=WebAppInfo(url=WEBAPP_URL))
    )
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
