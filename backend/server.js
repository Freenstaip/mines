import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(frontendDir));

const games = new Map();
const balances = new Map();

function getUserId(req) {
  // Для теста в браузере работает demo-user. В Telegram лучше заменить на проверку initData.
  const bodyUser = req.body?.userId;
  const headerUser = req.headers['x-user-id'];
  return String(bodyUser || headerUser || 'demo-user');
}

function getBalance(userId) {
  if (!balances.has(userId)) balances.set(userId, 279.71);
  return Number(balances.get(userId).toFixed(2));
}

function randomMines(count, firstPick = null) {
  const mines = new Set();
  while (mines.size < count) {
    const idx = crypto.randomInt(0, 25);
    if (idx !== firstPick) mines.add(idx);
  }
  return mines;
}

function coefficient(safeOpened, minesCount) {
  // Простая кривая выплат. Можно заменить на свою математику.
  const base = 1 + minesCount * 0.025;
  return Math.max(0.97, Number(Math.pow(base, safeOpened).toFixed(2)));
}

app.get('/api/me', (req, res) => {
  const userId = String(req.query.userId || 'demo-user');
  res.json({ userId, balance: getBalance(userId) });
});

app.post('/api/game/start', (req, res) => {
  const userId = getUserId(req);
  const bet = Number(req.body.bet || 0.2);
  const traps = Math.min(24, Math.max(1, Number(req.body.traps || 1)));
  const balance = getBalance(userId);

  if (!Number.isFinite(bet) || bet <= 0) return res.status(400).json({ error: 'Некорректная ставка' });
  if (bet > balance) return res.status(400).json({ error: 'Недостаточно средств' });

  balances.set(userId, Number((balance - bet).toFixed(2)));
  const gameId = crypto.randomUUID();
  games.set(gameId, {
    userId,
    bet,
    traps,
    mines: randomMines(traps),
    opened: new Set(),
    active: true
  });

  res.json({ gameId, bet, traps, balance: getBalance(userId), nextWin: Number((bet * coefficient(1, traps)).toFixed(2)) });
});

app.post('/api/game/open', (req, res) => {
  const userId = getUserId(req);
  const { gameId } = req.body;
  const index = Number(req.body.index);
  const game = games.get(gameId);

  if (!game || game.userId !== userId) return res.status(404).json({ error: 'Игра не найдена' });
  if (!game.active) return res.status(400).json({ error: 'Игра завершена' });
  if (!Number.isInteger(index) || index < 0 || index > 24) return res.status(400).json({ error: 'Некорректная клетка' });
  if (game.opened.has(index)) return res.status(400).json({ error: 'Клетка уже открыта' });

  if (game.mines.has(index)) {
    game.active = false;
    return res.json({
      result: 'mine',
      index,
      balance: getBalance(userId),
      mines: Array.from(game.mines),
      opened: Array.from(game.opened)
    });
  }

  game.opened.add(index);
  const mult = coefficient(game.opened.size, game.traps);
  const currentWin = Number((game.bet * mult).toFixed(2));
  const nextWin = Number((game.bet * coefficient(game.opened.size + 1, game.traps)).toFixed(2));

  if (game.opened.size >= 25 - game.traps) {
    game.active = false;
    balances.set(userId, Number((getBalance(userId) + currentWin).toFixed(2)));
  }

  res.json({
    result: 'safe',
    index,
    multiplier: mult,
    currentWin,
    nextWin,
    openedCount: game.opened.size,
    balance: getBalance(userId),
    completed: !game.active
  });
});

app.post('/api/game/cashout', (req, res) => {
  const userId = getUserId(req);
  const { gameId } = req.body;
  const game = games.get(gameId);

  if (!game || game.userId !== userId) return res.status(404).json({ error: 'Игра не найдена' });
  if (!game.active) return res.status(400).json({ error: 'Игра уже завершена' });
  if (game.opened.size === 0) return res.status(400).json({ error: 'Сначала откройте хотя бы одну клетку' });

  const win = Number((game.bet * coefficient(game.opened.size, game.traps)).toFixed(2));
  game.active = false;
  balances.set(userId, Number((getBalance(userId) + win).toFixed(2)));
  res.json({ result: 'cashout', win, balance: getBalance(userId), mines: Array.from(game.mines) });
});

app.get('*', (_, res) => res.sendFile(path.join(frontendDir, 'index.html')));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Mines app started on http://localhost:${port}`));
