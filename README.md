# Telegram Mines Demo Mini App

Проект изменён под демо-режим без реальных денег и без backend.

Пользователь открывает Telegram Mini App, получает демо-баланс **10.00$** и играет на него. Баланс хранится в браузере через `localStorage` отдельно для Telegram user id.

## Структура

```text
bot/                 Telegram bot на aiogram
frontend/            статический Telegram Mini App
frontend/assets/     ассеты ячейки, звезды и мины
backend/             старый backend оставлен как справочный, для демо не нужен
```

## Что реализовано

- `/start` в Telegram bot
- кнопка `Start`, открывающая Mini App
- Menu Button `Mini App`
- поле Mines 5x5
- демо-баланс 10.00$
- ставки
- выбор количества ловушек
- открытие клеток
- проигрыш при мине
- кнопка `Collect` для забора демо-выигрыша
- кнопка `Demo 10.00$` для сброса демо-баланса обратно на 10.00$
- все данные игры работают на frontend, без API и базы данных

## Деплой frontend на Cloudflare Pages

1. Загрузите проект на GitHub.
2. В Cloudflare Pages создайте новый проект из GitHub репозитория.
3. Настройки сборки:

```text
Build command: оставить пустым
Build output directory: frontend
```

После деплоя Cloudflare выдаст HTTPS ссылку вида:

```text
https://your-project.pages.dev
```

Её нужно указать в `.env` для бота как `WEBAPP_URL`.

## Запуск frontend локально

```bash
npm install
npm start
```

Откройте:

```text
http://localhost:3000
```

## Запуск Telegram bot

```bash
cd bot
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Создайте `.env` в корне проекта:

```env
BOT_TOKEN=ВАШ_ТОКЕН_БОТА
WEBAPP_URL=https://your-project.pages.dev
```

Запуск из папки `bot`:

```bash
python bot.py
```

## Важно

Для Telegram Mini App нужна HTTPS ссылка. Cloudflare Pages подходит.

Так как игра демо и без backend, пользователь может сбросить баланс очисткой кэша или кнопкой `Demo 10.00$`. Для демо-версии это нормально.
