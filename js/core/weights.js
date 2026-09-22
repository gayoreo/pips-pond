import { addDays, dayOfWeek, isDayOff, minKey } from './dates.js';

export const EQUAL_WEIGHTS = [1, 1, 1, 1, 1, 1, 1];
const MIN_DAYS = 21;  // need 3 weeks of history before learning anything
const FULL_DAYS = 42; // fully trust the pattern after 6 weeks

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * How much of the points budget each weekday gets (index 0 = Sunday).
 * Average is ~1. A weekday you usually spend twice as much on gets ~2.
 * Modes: 'auto' (learn from your history), 'equal' (every day the same).
 */
export function pointsWeights(settings, entries, today) {
  if (settings.weightMode === 'equal') return EQUAL_WEIGHTS;
  return learnWeights(settings, entries, today).weights;
}

export function learnWeights(settings, entries, today) {
  const daysOff = settings.daysOff ?? [];
  const to = minKey(addDays(today, -1), settings.end);
  const none = { weights: EQUAL_WEIGHTS, days: 0, learning: true };
  if (!settings.start || to < settings.start) return none;

  const byDate = new Map();
  for (const e of entries) {
    if (e.deleted || e.type !== 'points' || e.date < settings.start || e.date > to) continue;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + (Number(e.amount) || 0));
  }

  const spent = [0, 0, 0, 0, 0, 0, 0];
  const count = [0, 0, 0, 0, 0, 0, 0];
  let days = 0;
  let total = 0;
  for (let k = settings.start; k <= to; k = addDays(k, 1)) {
    if (isDayOff(k, daysOff)) continue;
    const dow = dayOfWeek(k);
    const amt = byDate.get(k) ?? 0;
    spent[dow] += amt;
    count[dow] += 1;
    total += amt;
    days += 1;
  }

  if (days < MIN_DAYS || total <= 0) return { ...none, days };

  const mean = total / days;
  const trust = Math.min(1, (days - MIN_DAYS + 7) / (FULL_DAYS - MIN_DAYS + 7));
  const weights = count.map((c, i) => {
    if (!c) return 1;
    const raw = spent[i] / c / mean;
    const clamped = Math.min(2.5, Math.max(0.25, raw));
    return round2(1 + (clamped - 1) * trust);
  });
  return { weights, days, learning: trust < 1 };
}
