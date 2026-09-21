export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function money(n) {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2);
}

export function count(n) {
  const r = Math.round(n * 10) / 10;
  const v = Object.is(r, -0) ? 0 : r;
  return (v < 0 ? '−' : '') + Math.abs(v);
}

// "1 swipe", "3 swipes"
export const plural = (n, word) => `${count(n)} ${Math.abs(n) === 1 ? word : `${word}s`}`;

export function applyTheme(theme = 'paper') {
  document.documentElement.dataset.theme = theme;
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper);
}