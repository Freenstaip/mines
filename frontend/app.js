const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const board = document.querySelector('#board');
const balanceEl = document.querySelector('#balance');
const betEl = document.querySelector('#bet');
const trapCountEl = document.querySelector('#trapCount');
const statusLabel = document.querySelector('#statusLabel');
const statusValue = document.querySelector('#statusValue');
const playBtn = document.querySelector('#playBtn');
const cashoutBtn = document.querySelector('#cashoutBtn');
const cashoutValue = document.querySelector('#cashoutValue');
const minusBtn = document.querySelector('#minus');
const plusBtn = document.querySelector('#plus');
const trapMinusBtn = document.querySelector('#trapMinus');
const trapPlusBtn = document.querySelector('#trapPlus');

const START_BALANCE = 10;
const MIN_BET = 0.10;
const DEFAULT_BET = 0.20;
const userId = tg?.initDataUnsafe?.user?.id || 'demo-user';
const storageKey = `mines-demo-balance:${userId}`;

let balance = readBalance();
let bet = DEFAULT_BET;
let traps = 1;
let active = false;
let mines = new Set();
let opened = new Set();
let currentWin = 0;

function money(value) {
  return Number(value || 0).toFixed(2);
}

function readBalance() {
  const saved = Number(localStorage.getItem(storageKey));

  // Если в браузере остался старый баланс 0 / NaN / отрицательный — выдаём новые демо $10.
  if (!Number.isFinite(saved) || saved < MIN_BET) {
    localStorage.setItem(storageKey, money(START_BALANCE));
    return START_BALANCE;
  }

  return saved;
}

function saveBalance() {
  localStorage.setItem(storageKey, money(balance));
}

function resetDemoBalance() {
  balance = START_BALANCE;
  saveBalance();
  sync();
}

function showMessage(text) {
  if (tg?.showAlert) tg.showAlert(text);
  else alert(text);
}

function coefficient(safeOpened, minesCount) {
  const base = 1 + minesCount * 0.08;
  return Number(Math.pow(base, safeOpened).toFixed(2));
}

function calcWin(openedCount = opened.size) {
  if (openedCount <= 0) return 0;
  return Number((bet * coefficient(openedCount, traps)).toFixed(2));
}

function randomMines(count, safeIndex = null) {
  const result = new Set();

  while (result.size < count) {
    const index = Math.floor(Math.random() * 25);
    if (index !== safeIndex) result.add(index);
  }

  return result;
}

function sync() {
  balanceEl.textContent = `${money(balance)} $`;
  betEl.textContent = money(bet);
  trapCountEl.textContent = traps;
}

function renderBoard() {
  board.innerHTML = '';

  for (let i = 0; i < 25; i += 1) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.type = 'button';
    cell.dataset.index = String(i);
    board.appendChild(cell);
  }
}

function setControlsForGame(isActive) {
  playBtn.classList.toggle('hidden', isActive);
  cashoutBtn.classList.toggle('hidden', !isActive);
}

function startGame(firstClickIndex = null) {
  if (active) return true;

  // В демо-режиме баланс всегда должен стартовать с $10, если старое значение закончилось.
  if (balance < MIN_BET) resetDemoBalance();

  if (bet > balance) {
    bet = Math.min(DEFAULT_BET, balance);
    if (bet < MIN_BET) {
      resetDemoBalance();
      bet = DEFAULT_BET;
    }
  }

  if (bet > balance) {
    showMessage('Недостаточно демо-средств');
    return false;
  }

  renderBoard();
  opened = new Set();
  mines = randomMines(traps, firstClickIndex);
  currentWin = 0;
  active = true;
  balance = Number((balance - bet).toFixed(2));
  saveBalance();

  statusLabel.textContent = 'Current win';
  statusValue.textContent = '0.00 $';
  cashoutValue.textContent = '0.00$';
  setControlsForGame(true);
  sync();
  return true;
}

function handleCellClick(index) {
  if (!active) {
    const started = startGame(index);
    if (!started) return;
  }

  const cell = board.querySelector(`.cell[data-index="${index}"]`);
  openCell(index, cell);
}

function openCell(index, cell) {
  if (!active || opened.has(index) || !cell) return;

  if (mines.has(index)) {
    cell.classList.add('open-mine', 'disabled');
    finishLose();
    return;
  }

  opened.add(index);
  cell.classList.add('open-star', 'disabled');

  currentWin = calcWin(opened.size);
  cashoutValue.textContent = `${money(currentWin)}$`;
  statusLabel.textContent = 'Current win';
  statusValue.textContent = `${money(currentWin)} $`;

  if (opened.size >= 25 - traps) collectWin();
}

function revealMines() {
  document.querySelectorAll('.cell').forEach((cell, i) => {
    cell.classList.add('disabled');
    if (mines.has(i)) cell.classList.add('open-mine');
  });
}

function finishLose() {
  active = false;
  currentWin = 0;
  revealMines();
  setControlsForGame(false);
  statusLabel.textContent = 'You lose';
  statusValue.textContent = '0.00 $';
  sync();
}

function collectWin() {
  if (!active) return;

  if (opened.size === 0) {
    showMessage('Сначала откройте хотя бы одну клетку');
    return;
  }

  active = false;
  balance = Number((balance + currentWin).toFixed(2));
  saveBalance();
  revealMines();
  setControlsForGame(false);
  statusLabel.textContent = 'Collected';
  statusValue.textContent = `${money(currentWin)} $`;
  sync();
}

function changeBet(delta) {
  if (active) return;
  bet = Math.max(MIN_BET, Number((bet + delta).toFixed(2)));
  if (bet > START_BALANCE) bet = START_BALANCE;
  sync();
}

function changeTraps(delta) {
  if (active) return;
  traps = Math.min(24, Math.max(1, traps + delta));
  sync();
}

board.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || !board.contains(cell)) return;
  handleCellClick(Number(cell.dataset.index));
});

minusBtn.addEventListener('click', () => changeBet(-0.10));
plusBtn.addEventListener('click', () => changeBet(0.10));
trapMinusBtn.addEventListener('click', () => changeTraps(-1));
trapPlusBtn.addEventListener('click', () => changeTraps(1));
playBtn.addEventListener('click', () => startGame());
cashoutBtn.addEventListener('click', collectWin);

renderBoard();
sync();
statusLabel.textContent = 'Balance';
statusValue.textContent = `${money(balance)} $`;
