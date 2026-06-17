const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const board = document.querySelector('#board');
const balanceEl = document.querySelector('#balance');
const walletEl = document.querySelector('#wallet');
const betEl = document.querySelector('#bet');
const trapCountEl = document.querySelector('#trapCount');
const statusLabel = document.querySelector('#statusLabel');
const statusValue = document.querySelector('#statusValue');
const playBtn = document.querySelector('#playBtn');
const cashoutBtn = document.querySelector('#cashoutBtn');
const cashoutValue = document.querySelector('#cashoutValue');
const demoBtn = document.querySelector('#demoBtn');

const START_BALANCE = 10;
const userId = tg?.initDataUnsafe?.user?.id || 'demo-user';
const storageKey = `mines-demo-balance:${userId}`;

let balance = getSavedBalance();
let bet = 0.20;
let traps = 1;
let active = false;
let mines = new Set();
let opened = new Set();
let currentWin = 0;

function getSavedBalance() {
  const saved = Number(localStorage.getItem(storageKey));
  return Number.isFinite(saved) ? saved : START_BALANCE;
}

function saveBalance() {
  localStorage.setItem(storageKey, money(balance));
}

function money(v) {
  return Number(v || 0).toFixed(2);
}

function sync() {
  balanceEl.textContent = money(balance);
  walletEl.textContent = `${money(balance)}$`;
  betEl.textContent = money(bet);
  trapCountEl.textContent = traps;
  demoBtn.textContent = `Demo ${money(START_BALANCE)}$`;
}

function toast(text) {
  tg?.showAlert ? tg.showAlert(text) : alert(text);
}

function coefficient(safeOpened, minesCount) {
  const base = 1 + minesCount * 0.025;
  return Math.max(0.97, Number(Math.pow(base, safeOpened).toFixed(2)));
}

function calcWin(openedCount = opened.size) {
  return Number((bet * coefficient(openedCount, traps)).toFixed(2));
}

function randomMines(count) {
  const result = new Set();
  while (result.size < count) {
    result.add(Math.floor(Math.random() * 25));
  }
  return result;
}

function renderBoard() {
  board.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.onclick = () => openCell(i, btn);
    board.appendChild(btn);
  }
}

function revealMines() {
  document.querySelectorAll('.cell').forEach((cell, i) => {
    cell.classList.add('disabled');
    if (mines.has(i)) cell.classList.add('open-mine');
  });
}

function startGame() {
  if (active) return;
  if (bet > balance) return toast('Недостаточно демо-средств');

  renderBoard();
  mines = randomMines(traps);
  opened = new Set();
  currentWin = 0;
  active = true;
  balance = Number((balance - bet).toFixed(2));
  saveBalance();

  playBtn.classList.add('hidden');
  cashoutBtn.classList.remove('hidden');
  statusLabel.textContent = 'Next step';
  statusValue.textContent = `${money(calcWin(1))} $`;
  cashoutValue.textContent = '0.00$';
  sync();
}

function openCell(index, el) {
  if (!active || opened.has(index)) return;

  if (mines.has(index)) {
    el.classList.add('open-mine', 'disabled');
    active = false;
    revealMines();
    playBtn.classList.remove('hidden');
    cashoutBtn.classList.add('hidden');
    statusLabel.textContent = 'You lose';
    statusValue.textContent = '0.00 $';
    currentWin = 0;
    sync();
    return;
  }

  opened.add(index);
  el.classList.add('open-star', 'disabled');
  currentWin = calcWin(opened.size);
  cashoutValue.textContent = `${money(currentWin)}$`;
  statusLabel.textContent = 'Next step';
  statusValue.textContent = `${money(calcWin(opened.size + 1))} $`;

  if (opened.size >= 25 - traps) {
    collectWin();
  }
}

function collectWin() {
  if (!active || opened.size === 0) return toast('Сначала откройте хотя бы одну клетку');
  active = false;
  balance = Number((balance + currentWin).toFixed(2));
  saveBalance();
  revealMines();
  playBtn.classList.remove('hidden');
  cashoutBtn.classList.add('hidden');
  statusLabel.textContent = 'Win';
  statusValue.textContent = `${money(currentWin)} $`;
  sync();
}

function resetDemoBalance() {
  if (active) return toast('Завершите текущую игру');
  balance = START_BALANCE;
  saveBalance();
  statusLabel.textContent = 'Demo balance';
  statusValue.textContent = `${money(balance)} $`;
  sync();
}

document.querySelector('#minus').onclick = () => {
  if (active) return;
  bet = Math.max(0.10, Number((bet - 0.10).toFixed(2)));
  sync();
};

document.querySelector('#plus').onclick = () => {
  if (active) return;
  bet = Number((bet + 0.10).toFixed(2));
  sync();
};

document.querySelector('#trapMinus').onclick = () => {
  if (!active) {
    traps = Math.max(1, traps - 1);
    sync();
  }
};

document.querySelector('#trapPlus').onclick = () => {
  if (!active) {
    traps = Math.min(24, traps + 1);
    sync();
  }
};

playBtn.onclick = startGame;
cashoutBtn.onclick = collectWin;
demoBtn.onclick = resetDemoBalance;

renderBoard();
sync();
statusLabel.textContent = 'Demo balance';
statusValue.textContent = `${money(balance)} $`;
