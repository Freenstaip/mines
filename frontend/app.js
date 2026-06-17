(() => {
  const tg = window.Telegram?.WebApp;
  try {
    tg?.ready?.();
    tg?.expand?.();
  } catch (_) {}

  const START_BALANCE = 10;
  const CELLS_COUNT = 25;
  const userId = tg?.initDataUnsafe?.user?.id || 'demo-user';
  const storageKey = `mines-demo-balance:${userId}`;

  let balance = readBalance();
  let bet = 0.20;
  let traps = 1;
  let active = false;
  let mines = new Set();
  let opened = new Set();
  let currentWin = 0;

  const $ = (selector) => document.querySelector(selector);

  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function readBalance() {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) ? saved : START_BALANCE;
  }

  function saveBalance() {
    localStorage.setItem(storageKey, money(balance));
  }

  function showMessage(text) {
    try {
      if (tg?.showAlert) tg.showAlert(text);
      else alert(text);
    } catch (_) {
      alert(text);
    }
  }

  function getEls() {
    return {
      board: $('#board'),
      balanceEl: $('#balance'),
      betEl: $('#bet'),
      trapCountEl: $('#trapCount'),
      statusLabel: $('#statusLabel'),
      statusValue: $('#statusValue'),
      playBtn: $('#playBtn'),
      cashoutBtn: $('#cashoutBtn'),
      cashoutValue: $('#cashoutValue'),
      minus: $('#minus'),
      plus: $('#plus'),
      trapMinus: $('#trapMinus'),
      trapPlus: $('#trapPlus'),
    };
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
      const index = Math.floor(Math.random() * CELLS_COUNT);
      if (index !== safeIndex) result.add(index);
    }
    return result;
  }

  function sync() {
    const els = getEls();
    els.balanceEl.textContent = `${money(balance)} $`;
    els.betEl.textContent = money(bet);
    els.trapCountEl.textContent = traps;
  }

  function renderBoard() {
    const { board } = getEls();
    board.innerHTML = '';

    for (let i = 0; i < CELLS_COUNT; i += 1) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.type = 'button';
      cell.dataset.index = String(i);
      cell.setAttribute('aria-label', `Cell ${i + 1}`);
      board.appendChild(cell);
    }
  }

  function setControlsForGame(isActive) {
    const { playBtn, cashoutBtn } = getEls();
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

    const { statusLabel, statusValue, cashoutValue } = getEls();
    statusLabel.textContent = 'Игра началась';
    statusValue.textContent = '0.00 $';
    cashoutValue.textContent = '0.00$';
    setControlsForGame(true);
    sync();
    return true;
  }

  function openCell(index) {
    const { board, statusLabel, statusValue, cashoutValue } = getEls();
    const cell = board.querySelector(`.cell[data-index="${index}"]`);
    if (!active || !cell || opened.has(index) || cell.classList.contains('disabled')) return;

    if (mines.has(index)) {
      cell.classList.add('open-mine', 'disabled');
      finishLose();
      return;
    }

    opened.add(index);
    cell.classList.add('open-star', 'disabled');

    currentWin = calcWin(opened.size);
    cashoutValue.textContent = `${money(currentWin)}$`;
    statusLabel.textContent = 'Текущий выигрыш';
    statusValue.textContent = `${money(currentWin)} $`;

    if (opened.size >= CELLS_COUNT - traps) collectWin();
  }

  function handleBoardClick(event) {
    const cell = event.target.closest('.cell');
    if (!cell) return;

    const index = Number(cell.dataset.index);
    if (!Number.isInteger(index)) return;

    if (!active && !startGame(index)) return;
    openCell(index);
  }

  function revealMines() {
    document.querySelectorAll('.cell').forEach((cell) => {
      const index = Number(cell.dataset.index);
      cell.classList.add('disabled');
      if (mines.has(index)) cell.classList.add('open-mine');
    });
  }

  function finishLose() {
    active = false;
    currentWin = 0;
    revealMines();
    setControlsForGame(false);

    const { statusLabel, statusValue } = getEls();
    statusLabel.textContent = 'Вы проиграли';
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

    const { statusLabel, statusValue } = getEls();
    statusLabel.textContent = 'Забрано';
    statusValue.textContent = `${money(currentWin)} $`;
    sync();
  }

  function changeBet(delta) {
    if (active) return;
    bet = Math.max(0.10, Number((bet + delta).toFixed(2)));
    if (bet > balance) bet = Number(balance.toFixed(2));
    if (bet < 0.10) bet = 0.10;
    sync();
  }

  function changeTraps(delta) {
    if (active) return;
    traps = Math.min(24, Math.max(1, traps + delta));
    sync();
  }

  function init() {
    const els = getEls();

    renderBoard();
    sync();
    els.statusLabel.textContent = 'Баланс';
    els.statusValue.textContent = `${money(balance)} $`;

    els.board.addEventListener('click', handleBoardClick);
    els.playBtn.addEventListener('click', () => startGame());
    els.cashoutBtn.addEventListener('click', collectWin);
    els.minus.addEventListener('click', () => changeBet(-0.10));
    els.plus.addEventListener('click', () => changeBet(0.10));
    els.trapMinus.addEventListener('click', () => changeTraps(-1));
    els.trapPlus.addEventListener('click', () => changeTraps(1));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
