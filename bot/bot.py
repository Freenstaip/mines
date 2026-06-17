import os
import asyncio
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://your-domain.com")

if not BOT_TOKEN:
    raise RuntimeError("Укажите BOT_TOKEN в .env")

bot = Bot(BOT_TOKEN)
dp = Dispatcher()

@dp.message(CommandStart())
async def start(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Start", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "👋 Добро пожаловать в Mines!\n\n"
        "Чтобы начать игру, нажмите кнопку Start или откройте Mini App в меню бота.",
        reply_markup=keyboard
    )

async def main():
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Mini App", web_app=WebAppInfo(url=WEBAPP_URL))
    )
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
