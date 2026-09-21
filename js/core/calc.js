import { addDays, startOfWeek, eatingDays, isDayOff, maxKey, minKey, dayOfWeek } from './dates.js';

export const DEFAULT_EXCHANGE_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
export const exchangeDaysOf = (s) => (Array.isArray(s?.exchangeDays) ? s.exchangeDays : DEFAULT_EXCHANGE_DAYS);
export const exchangeAllowedOn = (s, key) => exchangeDaysOf(s).includes(dayOfWeek(key));

// Swipes only come in whole numbers, so their allowances are rounded.
const WHOLE = { swipes: true, points: false };

function effect(entry, settings) {
  const a = Number(entry.amount) || 0;
  switch (entry.type) {
    case 'swipe':         return { swipes: a, points: 0 };
    case 'exchange':      return { swipes: settings.exchangeUsesSwipe ? a : 0, points: 0 };
    case 'points':        return { swipes: 0, points: a };
    case 'adjust-swipes': return { swipes: -a, points: 0 };
    case 'adjust-points': return { swipes: 0, points: -a };
    default:              return { swipes: 0, points: 0 };
  }
}

function sums(entries, settings, { from = '0000-00-00', to = '9999-12-31', adjustments = false } = {}) {
  const out = { swipes: 0, points: 0 };
  for (const e of entries) {
    if (e.deleted || e.date < from || e.date > to) continue;
    const isAdjust = e.type.startsWith('adjust');
    if (isAdjust !== adjustments) continue;
    const eff = effect(e, settings);
    out.swipes += eff.swipes;
    out.points += eff.points;
  }
  return out;
}

export function budget(settings, entries, today) {
  const { start, end } = settings;
  const daysOff = settings.daysOff ?? [];
  const totals = {
    swipes: Number(settings.swipesTotal) || 0,
    points: Number(settings.pointsTotal) || 0,
  };

  const weekStart = startOfWeek(today, settings.weekStart ?? 0);
  const weekEnd = addDays(weekStart, 6);

  const adj = sums(entries, settings, { to: today, adjustments: true });
  const spentAll = sums(entries, settings);
  const spentBeforeToday = sums(entries, settings, { to: addDays(today, -1) });
  const spentToday = sums(entries, settings, { from: today, to: today });
  const spentBeforeWeek = sums(entries, settings, { to: addDays(weekStart, -1) });
  const spentThisWeek = sums(entries, settings, { from: weekStart, to: today });

  const phase = today < start ? 'before' : today > end ? 'after' : 'during';
  const dayOff = phase !== 'during' || isDayOff(today, daysOff);

  const daysLeft = today > end ? 0 : eatingDays(maxKey(today, start), end, daysOff);
  const weekFrom = maxKey(weekStart, start);
  const weekTo = minKey(weekEnd, end);
  const daysFromWeek = weekFrom > end ? 0 : eatingDays(weekFrom, end, daysOff);
  const daysThisWeek = weekFrom > weekTo ? 0 : eatingDays(weekFrom, weekTo, daysOff);

  const part = (k) => {
    const r = WHOLE[k] ? Math.round : (x) => x;
    const balance = totals[k] - spentAll[k] - adj[k];
    const startToday = totals[k] - spentBeforeToday[k] - adj[k];
    const startWeek = totals[k] - spentBeforeWeek[k] - adj[k];
    const daily = dayOff || daysLeft === 0 ? 0 : r(startToday / daysLeft);
    const weekly = daysFromWeek === 0 ? 0 : r((startWeek * daysThisWeek) / daysFromWeek);
    return {
      total: totals[k],
      balance,
      daily,
      spentToday: spentToday[k],
      leftToday: daily - spentToday[k],
      weekly,
      leftWeek: weekly - spentThisWeek[k],
    };
  };

  const exchangesUsed = entries
    .filter((e) => !e.deleted && e.type === 'exchange' && e.date >= weekStart && e.date <= weekEnd)
    .reduce((n, e) => n + (Number(e.amount) || 0), 0);
  const limit = Number(settings.exchangeLimit) || 0;

  return {
    today, phase, dayOff, daysLeft,
    weekStart, weekResets: addDays(weekEnd, 1),
    swipes: part('swipes'),
    points: part('points'),
    exchanges: {
      used: exchangesUsed,
      limit,
      left: limit - exchangesUsed,
      allowedToday: exchangeAllowedOn(settings, today),
    },
  };
}