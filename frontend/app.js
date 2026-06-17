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
const multiplierStrip = document.querySelector('#multiplierStrip');

const START_BALANCE = 10;
const userId = tg?.initDataUnsafe?.user?.id || 'demo-user';
const storageKey = `mines-demo-balance:${userId}`;

let balance = readBalance();
let bet = 0.20;
const TRAP_OPTIONS = [1, 3, 5, 7];
let trapOptionIndex = 0;
let traps = TRAP_OPTIONS[trapOptionIndex];
let active = false;
let mines = new Set();
let opened = new Set();
let currentWin = 0;

function readBalance() {
  const saved = Number(localStorage.getItem(storageKey));

  if (!Number.isFinite(saved) || saved <= 0) {
    localStorage.setItem(storageKey, money(START_BALANCE));
    return START_BALANCE;
  }

  return saved;
}

function saveBalance() {
  localStorage.setItem(storageKey, money(balance));
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function showMessage(text) {
  if (tg?.showAlert) tg.showAlert(text);
  else alert(text);
}

function coefficient(safeOpened, minesCount) {
  const base = 1 + minesCount * 0.08;
  return Number(Math.pow(base, safeOpened).toFixed(2));
}

function multiplierForStep(step) {
  if (step <= 0) return 1;
  return coefficient(step, traps);
}

function calcWin(openedCount = opened.size) {
  if (openedCount <= 0) return 0;
  return Number((bet * multiplierForStep(openedCount)).toFixed(2));
}

function calcNextWin() {
  const nextStep = Math.min(opened.size + 1, 25 - traps);
  return Number((bet * multiplierForStep(nextStep)).toFixed(2));
}

function calcMaxWin() {
  const safeCells = 25 - traps;
  return calcWin(safeCells);
}

function renderMultipliers() {
  if (!multiplierStrip) return;

  multiplierStrip.innerHTML = '';

  if (!active) {
    multiplierStrip.classList.add('hidden');
    return;
  }

  multiplierStrip.classList.remove('hidden');

  const safeCells = 25 - traps;
  for (let offset = 1; offset <= 3; offset += 1) {
    const step = opened.size + offset;
    const item = document.createElement('div');
    item.className = `multiplier ${offset === 1 ? 'active' : 'muted'}`;
    item.textContent = step <= safeCells ? `X${multiplierForStep(step).toFixed(2)}` : '—';
    multiplierStrip.appendChild(item);
  }
}

function updateMaxWinPanel() {
  statusLabel.textContent = 'Max. win';
  statusValue.textContent = `${money(calcMaxWin())} $`;
  renderMultipliers();
}

function updateNextStepPanel() {
  statusLabel.textContent = 'Next step';
  statusValue.textContent = `${money(calcNextWin())} $`;
  renderMultipliers();
}

function randomMines(count, safeIndex = null) {
  const result = new Set();
  while (result.size < count) {
    const index = Math.floor(Math.random() * 25);
    if (index !== safeIndex) result.add(index);
  }
  return result;
}

function sync(updatePanel = true) {
  balanceEl.textContent = `${money(balance)} $`;
  betEl.textContent = money(bet);
  trapCountEl.textContent = traps;

  if (updatePanel) updateMaxWinPanel();
}

function renderBoard() {
  board.innerHTML = '';
  board.classList.remove('game-active');
  for (let i = 0; i < 25; i += 1) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.type = 'button';
    cell.dataset.index = String(i);
    cell.addEventListener('click', () => handleCellClick(i, cell));
    board.appendChild(cell);
  }
}

function setControlsForGame(isActive) {
  playBtn.classList.toggle('hidden', isActive);
  cashoutBtn.classList.toggle('hidden', !isActive);
}

function startGame(firstClickIndex = null) {
  if (active) return true;

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

  updateNextStepPanel();
  cashoutValue.textContent = '0.00$';
  board.classList.add('game-active');
  setControlsForGame(true);
  sync(false);
  return true;
}

function handleCellClick(index, cell) {
  if (!active) {
    const started = startGame(index);
    if (!started) return;
    cell = board.querySelector(`[data-index="${index}"]`);
  }

  openCell(index, cell);
}

function openCell(index, cell) {
  if (!active || opened.has(index) || !cell) return;

  if (mines.has(index)) {
    cell.classList.add('open-mine', 'disabled', 'hit');
    finishLose();
    return;
  }

  opened.add(index);
  cell.classList.add('open-star', 'disabled', 'opened-pop');

  currentWin = calcWin(opened.size);
  cashoutValue.textContent = `${money(currentWin)}$`;
  updateNextStepPanel();

  if (opened.size >= 25 - traps) collectWin();
}

function revealMines() {
  document.querySelectorAll('.cell').forEach((cell, i) => {
    cell.classList.add('disabled');
    if (mines.has(i)) {
      setTimeout(() => cell.classList.add('open-mine', 'reveal-pop'), i * 18);
    }
  });
}

function finishLose() {
  active = false;
  currentWin = 0;
  revealMines();
  board.classList.remove('game-active');
  setControlsForGame(false);
  statusLabel.textContent = 'You lose';
  statusValue.textContent = '0.00 $';
  renderMultipliers();
  sync(false);
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
  board.classList.remove('game-active');
  setControlsForGame(false);
  statusLabel.textContent = 'Collected';
  statusValue.textContent = `${money(currentWin)} $`;
  renderMultipliers();
  sync(false);
}

function changeBet(delta) {
  if (active) return;
  bet = Math.max(0.10, Number((bet + delta).toFixed(2)));
  sync();
}

function changeTraps(delta) {
  if (active) return;

  trapOptionIndex += delta;
  if (trapOptionIndex < 0) trapOptionIndex = TRAP_OPTIONS.length - 1;
  if (trapOptionIndex >= TRAP_OPTIONS.length) trapOptionIndex = 0;

  traps = TRAP_OPTIONS[trapOptionIndex];
  sync();
}

document.querySelector('#minus').addEventListener('click', () => changeBet(-0.10));
document.querySelector('#plus').addEventListener('click', () => changeBet(0.10));
document.querySelector('#trapMinus').addEventListener('click', () => changeTraps(-1));
document.querySelector('#trapPlus').addEventListener('click', () => changeTraps(1));
playBtn.addEventListener('click', () => startGame());
cashoutBtn.addEventListener('click', collectWin);

renderBoard();
sync();
updateMaxWinPanel();
