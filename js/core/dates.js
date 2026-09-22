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

// "19:05" -> "7:05 PM". Returns '' for anything that isn't a HH:MM string.
export function formatHM(hm) {
  if (!/^\d{1,2}:\d{2}$/.test(hm ?? '')) return '';
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A short "how long ago" for a timestamp: "just now", "5m ago", "2h ago", "3d ago".
export function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatShort(toKey(new Date(iso)));
}

// The HH:MM (24h) part of an ISO timestamp, in the local time zone.
export function hmOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}