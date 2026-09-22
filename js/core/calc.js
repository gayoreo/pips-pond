import { addDays, startOfWeek, eatingDays, isDayOff, maxKey, minKey, dayOfWeek } from './dates.js';
import { pointsWeights, EQUAL_WEIGHTS } from './weights.js';

export const DEFAULT_EXCHANGE_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
export const exchangeDaysOf = (s) => (Array.isArray(s?.exchangeDays) ? s.exchangeDays : DEFAULT_EXCHANGE_DAYS);
export const exchangeAllowedOn = (s, key) => exchangeDaysOf(s).includes(dayOfWeek(key));

// "Base" entries change how much you have, instead of being spending:
// balance fixes (adjust-*) and money/swipes you added mid-semester (fund-*).
export const isBaseChange = (type) => type.startsWith('adjust') || type.startsWith('fund');

// Semester totals = plan amount + anything rolled over from last semester.
export function totalsOf(settings) {
  return {
    swipes: (Number(settings.swipesTotal) || 0) + (Number(settings.swipesRolledIn) || 0),
    points: (Number(settings.pointsTotal) || 0) + (Number(settings.pointsRolledIn) || 0),
  };
}

function effect(entry, settings) {
  const a = Number(entry.amount) || 0;
  switch (entry.type) {
    case 'swipe':         return { swipes: a, points: 0 };
    case 'exchange':      return { swipes: settings.exchangeUsesSwipe ? a : 0, points: 0 };
    case 'points':        return { swipes: 0, points: a };
    case 'adjust-swipes':
    case 'fund-swipes':   return { swipes: -a, points: 0 };
    case 'adjust-points':
    case 'fund-points':   return { swipes: 0, points: -a };
    default:              return { swipes: 0, points: 0 }; // guest passes etc.
  }
}

function sums(entries, settings, { from = '0000-00-00', to = '9999-12-31', base = false } = {}) {
  const out = { swipes: 0, points: 0 };
  for (const e of entries) {
    if (e.deleted || e.date < from || e.date > to) continue;
    if (isBaseChange(e.type) !== base) continue;
    const eff = effect(e, settings);
    out.swipes += eff.swipes;
    out.points += eff.points;
  }
  return out;
}

// Current balances (all entries, including future-dated ones).
export function balances(settings, entries) {
  const t = totalsOf(settings);
  const spent = sums(entries, settings);
  const base = sums(entries, settings, { base: true });
  return { swipes: t.swipes - spent.swipes - base.swipes, points: t.points - spent.points - base.points };
}

function weightedDays(from, to, daysOff, w) {
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    if (!isDayOff(k, daysOff)) n += w[dayOfWeek(k)];
  }
  return n;
}

export function budget(settings, entries, today, { weights } = {}) {
  const { start, end } = settings;
  const daysOff = settings.daysOff ?? [];
  const totals = totalsOf(settings);
  const w = weights ?? pointsWeights(settings, entries, today);

  const weekStart = startOfWeek(today, settings.weekStart ?? 0);
  const weekEnd = addDays(weekStart, 6);

  const base = sums(entries, settings, { to: today, base: true });
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
  const semesterDays = end < start ? 0 : eatingDays(start, end, daysOff);

  // ---- swipes: a whole-number weekly pool ----
  const swipes = (() => {
    const balance = totals.swipes - spentAll.swipes - base.swipes;
    const startWeek = totals.swipes - spentBeforeWeek.swipes - base.swipes;
    const daysFromWeek = weekFrom > end ? 0 : eatingDays(weekFrom, end, daysOff);
    const daysThisWeek = weekFrom > weekTo ? 0 : eatingDays(weekFrom, weekTo, daysOff);
    const weekly = daysFromWeek === 0 ? 0 : Math.round((startWeek * daysThisWeek) / daysFromWeek);
    const available = weekly - (spentThisWeek.swipes - spentToday.swipes);
    return {
      total: totals.swipes,
      balance,
      weekly,
      usedWeek: spentThisWeek.swipes,
      daily: available,                          // what you had when today started
      spentToday: spentToday.swipes,
      leftToday: available - spentToday.swipes,  // same as leftWeek
      leftWeek: weekly - spentThisWeek.swipes,
      planWeekly: semesterDays ? (totals.swipes * 7) / semesterDays : 0,
    };
  })();

  // ---- points: a daily amount, weighted by weekday habits ----
  const points = (() => {
    const balance = totals.points - spentAll.points - base.points;
    const startToday = totals.points - spentBeforeToday.points - base.points;
    const startWeek = totals.points - spentBeforeWeek.points - base.points;
    const wLeft = today > end ? 0 : weightedDays(maxKey(today, start), end, daysOff, w);
    const wFromWeek = weekFrom > end ? 0 : weightedDays(weekFrom, end, daysOff, w);
    const wThisWeek = weekFrom > weekTo ? 0 : weightedDays(weekFrom, weekTo, daysOff, w);
    const daily = dayOff || wLeft === 0 ? 0 : (startToday * w[dayOfWeek(today)]) / wLeft;
    const weekly = wFromWeek === 0 ? 0 : (startWeek * wThisWeek) / wFromWeek;
    return {
      total: totals.points,
      balance,
      weekly,
      usedWeek: spentThisWeek.points,
      daily,
      spentToday: spentToday.points,
      leftToday: daily - spentToday.points,
      leftWeek: weekly - spentThisWeek.points,
      planDaily: semesterDays ? totals.points / semesterDays : 0,
    };
  })();

  const exchangesUsed = entries
    .filter((e) => !e.deleted && e.type === 'exchange' && e.date >= weekStart && e.date <= weekEnd)
    .reduce((n, e) => n + (Number(e.amount) || 0), 0);
  const limit = Number(settings.exchangeLimit) || 0;

  const guestTotal = Number(settings.guestTotal) || 0;
  const guestsUsed = entries
    .filter((e) => !e.deleted && e.type === 'guest')
    .reduce((n, e) => n + (Number(e.amount) || 0), 0);

  // Finals / spend-down: the last two weeks of the semester.
  const finals = phase === 'during' && addDays(today, 13) >= end;

  return {
    today, phase, dayOff, daysLeft, finals,
    weekStart, weekResets: addDays(weekEnd, 1),
    weights: w,
    swipes,
    points,
    exchanges: {
      used: exchangesUsed,
      limit,
      left: limit - exchangesUsed,
      allowedToday: exchangeAllowedOn(settings, today),
    },
    guests: { total: guestTotal, used: guestsUsed, left: guestTotal - guestsUsed },
  };
}

export { EQUAL_WEIGHTS };
