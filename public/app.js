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
const partnerModal = document.querySelector('#partnerModal');
const partnerTitle = document.querySelector('#partnerTitle');
const partnerText = document.querySelector('#partnerText');
const partnerButton = document.querySelector('#partnerButton');
const directPartnerBtn = document.querySelector('#directPartnerBtn');


function updateViewportAndBoardSize() {
  const height = tg?.viewportStableHeight || tg?.viewportHeight || window.innerHeight;
  if (height) {
    document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  }

  if (!board) return;
  const boardWidth = board.clientWidth;
  if (!boardWidth) return;

  const computed = window.getComputedStyle(board);
  const gap = Number.parseFloat(computed.columnGap || computed.gap || '0') || 0;
  const cellSize = Math.max(38, Math.floor((boardWidth - gap * 4) / 5));
  document.documentElement.style.setProperty('--board-cell-size', `${cellSize}px`);

  board.querySelectorAll('.cell').forEach((cell) => {
    cell.style.height = `${cellSize}px`;
    cell.style.minHeight = `${cellSize}px`;
  });
}

if (/Android/i.test(navigator.userAgent || '')) {
  document.body.classList.add('android-webview');
}

window.addEventListener('resize', updateViewportAndBoardSize);
window.addEventListener('orientationchange', () => setTimeout(updateViewportAndBoardSize, 250));
tg?.onEvent?.('viewportChanged', updateViewportAndBoardSize);

const START_BALANCE = 10;
const DEFAULT_PARTNER_URL = 'https://lkfg.pro/a4e2c7';
const tgUser = tg?.initDataUnsafe?.user || null;
let storedUserId = localStorage.getItem('mines--user-id');
if (!tgUser?.id && (!storedUserId || storedUserId === '-user' || storedUserId === 'demo-user')) {
  storedUserId = `guest-${crypto.randomUUID()}`;
  localStorage.setItem('mines--user-id', storedUserId);
}
const userId = String(tgUser?.id || storedUserId || `guest-${crypto.randomUUID()}`);
localStorage.setItem('mines--user-id', userId);

const storageKey = `mines--state:${userId}`;
const legacyBalanceKey = `mines--balance:${userId}`;

let appState = readState();
let balance = appState.balance;
let bet = 0.20;
const TRAP_OPTIONS = [1, 3, 5, 7];
let trapOptionIndex = 0;
let traps = TRAP_OPTIONS[trapOptionIndex];
let active = false;
let mines = new Set();
let opened = new Set();
let currentWin = 0;
let partnerUrl = DEFAULT_PARTNER_URL;
let locked = Boolean(appState.locked);

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (Number.isFinite(parsed.balance)) return normalizeState(parsed);
  } catch {}

  const legacyBalance = Number(localStorage.getItem(legacyBalanceKey));
  return normalizeState({ balance: Number.isFinite(legacyBalance) && legacyBalance > 0 ? legacyBalance : START_BALANCE });
}

function normalizeState(state) {
  return {
    balance: Number.isFinite(Number(state.balance)) ? Number(Number(state.balance).toFixed(2)) : START_BALANCE,
    gamesPlayed: Number.isFinite(Number(state.gamesPlayed)) ? Number(state.gamesPlayed) : 0,
    triggerAfter: Number.isFinite(Number(state.triggerAfter)) ? Number(state.triggerAfter) : randomInt(3, 5),
    locked: Boolean(state.locked),
    clickedPartner: Boolean(state.clickedPartner),
    popupShown: Boolean(state.popupShown),
    resetNonce: state.resetNonce || '',
    createdAt: state.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function saveState() {
  appState.balance = Number(balance.toFixed(2));
  appState.locked = Boolean(locked);
  appState.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey, JSON.stringify(appState));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function showMessage(text) {
  if (tg?.showAlert) tg.showAlert(text);
  else alert(text);
}

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
        'x-tg-username': tgUser?.username || '',
        'x-tg-first-name': tgUser?.first_name || '',
        'x-tg-last-name': tgUser?.last_name || '',
        'x-tg-language-code': tgUser?.language_code || '',
        ...(options.headers || {})
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadRemoteState() {
  const params = new URLSearchParams({
    userId,
    username: tgUser?.username || '',
    firstName: tgUser?.first_name || '',
    lastName: tgUser?.last_name || '',
    languageCode: tgUser?.language_code || ''
  });
  const remote = await api(`/api/player?${params.toString()}`);
  if (!remote) {
    applyLockIfNeeded();
    return;
  }

  partnerUrl = remote.partnerUrl || partnerUrl;
  if (Number.isFinite(Number(remote.triggerAfter))) appState.triggerAfter = Number(remote.triggerAfter);
  if (Number.isFinite(Number(remote.gamesPlayed))) appState.gamesPlayed = Math.max(Number(appState.gamesPlayed || 0), Number(remote.gamesPlayed));
  if (Number.isFinite(Number(remote.balance)) && !active) balance = Number(remote.balance);

  if (remote.resetNonce && remote.resetNonce !== appState.resetNonce) {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(legacyBalanceKey);
    appState = normalizeState({ resetNonce: remote.resetNonce, balance: START_BALANCE, triggerAfter: Number(remote.triggerAfter) || randomInt(3, 5) });
    appState.resetNonce = remote.resetNonce;
    balance = START_BALANCE;
    locked = false;
    active = false;
    partnerModal.classList.add('hidden');
    partnerModal.setAttribute('aria-hidden', 'true');
    renderBoard();
    setControlsForGame(false);
    saveState();
  }

  if (remote.locked || remote.clickedPartner) {
    locked = true;
    appState.locked = true;
    appState.clickedPartner = Boolean(remote.clickedPartner || appState.clickedPartner);
    saveState();
  }

  saveState();
  applyLockIfNeeded();
  sync();
}

async function track(event, extra = {}) {
  const payload = {
    userId,
    user: tgUser,
    event,
    resetNonce: appState.resetNonce || '',
    ...extra
  };

  if (event === 'game_finished' || event === 'partner_click' || event === 'direct_partner_click' || event === 'locked') {
    payload.state = appState;
  }

  return api('/api/track', { method: 'POST', body: JSON.stringify(payload) });
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
  statusLabel.textContent = locked ? 'Continue' : 'Max. win';
  statusValue.textContent = locked ? 'On site' : `${money(calcMaxWin())} $`;
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
  playBtn.disabled = locked;
  cashoutBtn.disabled = locked;
  if (directPartnerBtn) directPartnerBtn.disabled = locked;

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
  updateViewportAndBoardSize();
  requestAnimationFrame(updateViewportAndBoardSize);
  if (locked) lockBoard();
}

function lockBoard() {
  document.querySelectorAll('.cell').forEach((cell) => cell.classList.add('disabled'));
  board.classList.remove('game-active');
}

function setControlsForGame(isActive) {
  playBtn.classList.toggle('hidden', isActive);
  directPartnerBtn?.classList.toggle('hidden', isActive || locked);
  cashoutBtn.classList.toggle('hidden', !isActive);
}

function startGame(firstClickIndex = null) {
  if (locked) {
    showPartnerModal('The game must be continued on the website', 'To continue the game, please go to the partner site.');
    return false;
  }
  if (active) return true;

  if (bet > balance) {
    showMessage('Insufficient funds');
    return false;
  }

  renderBoard();
  opened = new Set();
  mines = randomMines(traps, firstClickIndex);
  currentWin = 0;
  active = true;
  balance = Number((balance - bet).toFixed(2));
  saveState();

  updateNextStepPanel();
  cashoutValue.textContent = '0.00$';
  board.classList.add('game-active');
  setControlsForGame(true);
  sync(false);
  return true;
}

function handleCellClick(index, cell) {
  if (locked) {
    showPartnerModal('The game must be continued on the website', 'To continue the game, please go to the partner site.');
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
  if (!active || opened.has(index) || !cell || locked) return;

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
  finishRound('lose');
}

function collectWin() {
  if (locked) return;
  if (!active) return;
  if (opened.size === 0) {
    showMessage('First, open at least one cell');
    return;
  }

  active = false;
  balance = Number((balance + currentWin).toFixed(2));
  revealMines();
  board.classList.remove('game-active');
  setControlsForGame(false);
  statusLabel.textContent = 'Collected';
  statusValue.textContent = `${money(currentWin)} $`;
  renderMultipliers();
  sync(false);
  finishRound('win');
}

function finishRound(result) {
  appState.gamesPlayed += 1;
  saveState();
  track('game_finished', { result, balance, gamesPlayed: appState.gamesPlayed });

  const lostBeforeFiveGames = balance <= 0 && appState.gamesPlayed <= 5;
  const playedEnough = appState.gamesPlayed >= appState.triggerAfter;

  if (lostBeforeFiveGames) {
    forcePartner('The money has run out', offerText());
  } else if (playedEnough) {
    forcePartner('Continuation of the game', offerText());
  }
}

function offerText() {
  return `You won ${money(balance)}$. To receive funds, go to the website.`;
}

function forcePartner(title, text) {
  locked = true;
  appState.locked = true;
  appState.popupShown = true;
  active = false;
  saveState();
  track('locked', { reason: title });
  lockBoard();
  setControlsForGame(false);
  sync();
  setTimeout(() => showPartnerModal(title, text), 500);
}

function showPartnerModal(title, text) {
  partnerTitle.textContent = title;
  partnerText.textContent = appState.clickedPartner
    ? 'You can continue the game on the website. Click the button below to proceed.'
    : text;
  partnerModal.classList.remove('hidden');
  partnerModal.setAttribute('aria-hidden', 'false');
}

function applyLockIfNeeded() {
  if (!locked) return;
  lockBoard();
  setControlsForGame(false);
  sync();
  showPartnerModal('The game must be continued on the website', 'To continue the game, please go to the partner site.');
}

function openPartner() {
  appState.clickedPartner = true;
  locked = true;
  saveState();
  track('partner_click', { balance, gamesPlayed: appState.gamesPlayed });

  if (tg?.openLink) tg.openLink(partnerUrl);
  else window.location.href = partnerUrl;
}

function openDirectPartner() {
  appState.clickedPartner = true;
  locked = true;
  saveState();
  track('direct_partner_click', { balance, gamesPlayed: appState.gamesPlayed });

  if (tg?.openLink) tg.openLink(partnerUrl);
  else window.location.href = partnerUrl;
}

function changeBet(delta) {
  if (active || locked) return;
  bet = Math.max(0.10, Number((bet + delta).toFixed(2)));
  sync();
}

function changeTraps(delta) {
  if (active || locked) return;

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
partnerButton.addEventListener('click', openPartner);
directPartnerBtn?.addEventListener('click', openDirectPartner);

renderBoard();
sync();
updateMaxWinPanel();

(async function initPlayer() {
  await loadRemoteState();
  await track('visit');
})();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && locked) {
    showPartnerModal('The game must be continued on the website', 'To continue the game, please go to the partner site.');
  }
});

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
