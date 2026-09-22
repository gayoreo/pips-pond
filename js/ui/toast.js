let timer;

// toast('Saved.')                                   a plain message
// toast('Deleted.', 3500)                           a message that stays longer
// toast('Deleted.', { undo: () => restore() })      a message with an undo button
export function toast(message, opts = {}) {
  const { ms, undo = null, label = 'undo' } = typeof opts === 'number' ? { ms: opts } : opts;
  const life = ms ?? (undo ? 6000 : 2200);
  document.querySelector('.toast')?.remove();
  clearTimeout(timer);
  const el = document.createElement('div');
  el.className = `toast${undo ? ' toast--undo' : ''}`;
  el.setAttribute('role', 'status');
  el.append(message);
  if (undo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast__undo';
    button.textContent = label;
    button.addEventListener('click', () => {
      clearTimeout(timer);
      el.remove();
      undo();
    });
    el.append(button);
  }
  document.body.append(el);
  timer = setTimeout(() => el.remove(), life);
}
