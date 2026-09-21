let timer;

export function toast(message, ms = 2200) {
  document.querySelector('.toast')?.remove();
  clearTimeout(timer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  timer = setTimeout(() => el.remove(), ms);
}