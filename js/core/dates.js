export function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => toKey(new Date());

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export const dayOfWeek = (key) => fromKey(key).getDay(); // 0 = Sunday

export function startOfWeek(key, weekStart = 0) {
  const diff = (dayOfWeek(key) - weekStart + 7) % 7;
  return addDays(key, -diff);
}

export const minKey = (a, b) => (a < b ? a : b);
export const maxKey = (a, b) => (a > b ? a : b);

export function isDayOff(key, daysOff = []) {
  return daysOff.some((r) => key >= r.from && key <= r.to);
}

export function eatingDays(from, to, daysOff = []) {
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    if (!isDayOff(k, daysOff)) n++;
  }
  return n;
}

// ---- months (for the calendar) ----
export const monthKey = (key) => key.slice(0, 7); // "2026-09"

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// ---- display ----
export const formatLong = (key) =>
  fromKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

export const formatShort = (key) =>
  fromKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const formatMonth = (ym) =>
  fromKey(`${ym}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });