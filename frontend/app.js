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
const PARTNER_URL = window.PARTNER_URL || 'https://partner-site.com';
const userId = tg?.initDataUnsafe?.user?.id || 'demo-user';
const storagePrefix = `mines-demo:${userId}`;
const storageKey = `${storagePrefix}:balance`;
const gamesCountKey = `${storagePrefix}:games-count`;
const blockedKey = `${storagePrefix}:blocked`;
const thresholdKey = `${storagePrefix}:partner-threshold`;
const clickedKey = `${storagePrefix}:partner-clicked`;
const tgUser = tg?.initDataUnsafe?.user || null;

function apiEvent(payload = {}) {
  if (userId === 'demo-user') return Promise.resolve();

  return fetch('/api/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId,
      username: tgUser?.username || '',
      firstName: tgUser?.first_name || '',
      ...payload,
    }),
  }).catch(() => {});
}

function partnerGoUrl() {
  if (userId === 'demo-user') return PARTNER_URL;
  return `/go?uid=${encodeURIComponent(userId)}`;
}

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

  if (!Number.isFinite(saved)) {
    localStorage.setItem(storageKey, money(START_BALANCE));
    return START_BALANCE;
  }

  return Math.max(0, saved);
}

function saveBalance() {
  localStorage.setItem(storageKey, money(balance));
}

function money(value) {
  return Number(value || 0).toFixed(2);
}


function getGamesCount() {
  return Number(localStorage.getItem(gamesCountKey) || 0);
}

function setGamesCount(value) {
  localStorage.setItem(gamesCountKey, String(value));
}

function getPartnerThreshold() {
  let threshold = Number(localStorage.getItem(thresholdKey));

  if (!Number.isInteger(threshold) || threshold < 3 || threshold > 5) {
    threshold = Math.floor(Math.random() * 3) + 3;
    localStorage.setItem(thresholdKey, String(threshold));
  }

  return threshold;
}

function isBlocked() {
  return localStorage.getItem(blockedKey) === '1';
}

function partnerScreenText() {
  return localStorage.getItem(clickedKey) === '1'
    ? 'Игру можно продолжить на сайте партнёра.'
    : 'Демо-игра завершена. Продолжите игру на сайте партнёра.';
}

function renderPartnerLock() {
  active = false;
  document.body.innerHTML = `
    <main class="app" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;">
      <section class="info-card" style="width:100%;max-width:420px;text-align:center;display:block;">
        <h2 style="margin:0 0 12px;">Продолжить игру</h2>
        <p style="margin:0 0 20px;color:rgba(255,255,255,.75);line-height:1.45;">${partnerScreenText()}</p>
        <button id="partnerGoBtn" class="play" type="button" style="width:100%;">Перейти на сайт</button>
      </section>
    </main>
  `;

  document.querySelector('#partnerGoBtn')?.addEventListener('click', () => {
    localStorage.setItem(clickedKey, '1');
    apiEvent({ clicked: true, blocked: true, gamesCount: getGamesCount(), reason: 'partner_click' });
    window.location.href = partnerGoUrl();
  });
}

function showPartnerModal(reason = 'partner_popup') {
  localStorage.setItem(blockedKey, '1');
  apiEvent({ blocked: true, gamesCount: getGamesCount(), reason });
  renderPartnerLock();
}

function checkPartnerTrigger() {
  apiEvent({ gamesCount: getGamesCount(), blocked: isBlocked(), reason: 'app_open' });

if (isBlocked()) {
    renderPartnerLock();
    return true;
  }

  const gamesCount = getGamesCount();

  if (gamesCount >= getPartnerThreshold()) {
    showPartnerModal('games_limit');
    return true;
  }

  if (balance <= 0 && gamesCount <= 5) {
    showPartnerModal('demo_balance_lost');
    return true;
  }

  return false;
}

function markGameFinished() {
  const gamesCount = getGamesCount() + 1;
  setGamesCount(gamesCount);
  apiEvent({ gamesCount, blocked: isBlocked(), reason: 'game_finished' });
  checkPartnerTrigger();
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
  if (isBlocked()) {
    renderPartnerLock();
    return false;
  }

  if (active) return true;

  if (bet > balance) {
    showMessage('Недостаточно демо-средств');
    checkPartnerTrigger();
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
  if (isBlocked()) {
    renderPartnerLock();
    return;
  }

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

    const isMine = mines.has(i);
    const delay = i * 18;

    setTimeout(() => {
      cell.classList.remove('open-star', 'open-mine');
      cell.classList.add(isMine ? 'open-mine' : 'open-star', 'reveal-pop');
    }, delay);
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
  markGameFinished();
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
  markGameFinished();
}

function changeBet(delta) {
  if (active || isBlocked()) return;
  bet = Math.max(0.10, Number((bet + delta).toFixed(2)));
  sync();
}

function changeTraps(delta) {
  if (active || isBlocked()) return;

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

if (isBlocked()) {
  renderPartnerLock();
} else {
  renderBoard();
  sync();
  updateMaxWinPanel();
}

// Отключение случайного zoom на телефонах: double tap и pinch zoom
let lastTouchEnd = 0;

document.addEventListener('touchend', function (event) {
  const now = Date.now();

  if (now - lastTouchEnd <= 300) {
    event.preventDefault();
  }

  lastTouchEnd = now;
}, { passive: false });

document.addEventListener('gesturestart', function (event) {
  event.preventDefault();
}, { passive: false });

document.addEventListener('gesturechange', function (event) {
  event.preventDefault();
}, { passive: false });

document.addEventListener('gestureend', function (event) {
  event.preventDefault();
}, { passive: false });

// Запрещаем только горизонтальный свайп страницы, вертикальная прокрутка остается рабочей
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', function (event) {
  if (!event.touches || event.touches.length !== 1) return;
  touchStartX = event.touches[0].clientX;
  touchStartY = event.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', function (event) {
  if (!event.touches || event.touches.length !== 1) return;

  const dx = Math.abs(event.touches[0].clientX - touchStartX);
  const dy = Math.abs(event.touches[0].clientY - touchStartY);

  if (dx > dy && dx > 6) {
    event.preventDefault();
  }
}, { passive: false });
