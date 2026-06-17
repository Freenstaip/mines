
function revealMines() {
  document.querySelectorAll('.cell').forEach((cell, i) => {
    cell.classList.add('disabled');

    const isMine = mines.has(i);

    // Не трогаем клетку, на которую игрок нажал и проиграл
    if (cell.classList.contains('hit')) return;

    setTimeout(() => {
      cell.classList.remove('open-star', 'open-mine');
      if (isMine) {
        cell.classList.add('open-mine', 'reveal-pop');
      } else {
        cell.classList.add('open-star', 'reveal-pop');
      }
    }, i * 18);
  });
}
