// Escape text before putting it inside HTML.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// $12.50 style. Tiny floating-point leftovers count as zero.
export function money(n) {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2);
}

// Swipe counts with at most one decimal (1.4, 12, 0.5).
export function count(n) {
  const r = Math.round(n * 10) / 10;
  const v = Object.is(r, -0) ? 0 : r;
  return (v < 0 ? '−' : '') + Math.abs(v);
}

export function applyTheme(theme = 'paper') {
  document.documentElement.dataset.theme = theme;
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper);
}