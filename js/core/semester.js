import { budget, balances, totalsOf } from './calc.js';
import { addDays, startOfWeek, isDayOff, minKey, todayKey } from './dates.js';
import { moodFor } from '../pip/mood.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function seasonName(key) {
  const m = Number(key.slice(5, 7));
  const season = m <= 5 ? 'Spring' : m <= 7 ? 'Summer' : 'Fall';
  return `${season} ${key.slice(0, 4)}`;
}

function nextName(name, fallbackStart) {
  const m = /^(Fall|Spring|Summer|Winter)\s+(\d{4})$/i.exec((name ?? '').trim());
  if (!m) return seasonName(fallbackStart);
  const y = Number(m[2]);
  const s = m[1].toLowerCase();
  if (s === 'fall') return `Spring ${y + 1}`;
  if (s === 'winter') return `Spring ${y}`;
  return `Fall ${y}`; // spring or summer
}

// What carries into next semester, based on the rollover switches.
export function rolloverFor(settings, entries) {
  const bal = balances(settings, entries);
  return {
    swipes: settings.swipesRollover ? Math.max(0, Math.round(bal.swipes)) : 0,
    points: settings.pointsRollover ? Math.max(0, round2(bal.points)) : 0,
  };
}

// Prefilled answers for the "new semester" setup.
export function nextSemesterDefaults(settings, entries) {
  const roll = rolloverFor(settings, entries);
  const today = todayKey();
  const start = today > settings.end ? today : addDays(settings.end, 1);
  return {
    ...settings,
    semesterName: nextName(settings.semesterName, start),
    start,
    end: addDays(start, 104),
    daysOff: [],
    swipesRolledIn: roll.swipes,
    pointsRolledIn: roll.points,
    rolledFrom: settings.semesterName,
  };
}

// Numbers for the semester report card.
export function reportStats(settings, entries) {
  const live = entries.filter((e) => !e.deleted);
  const totals = totalsOf(settings);
  const bal = balances(settings, live);
  const last = minKey(todayKey(), settings.end);

  let swipesUsed = 0, pointsSpent = 0, exchanges = 0, guests = 0;
  for (const e of live) {
    const a = Number(e.amount) || 0;
    if (e.type === 'swipe') swipesUsed += a;
    if (e.type === 'exchange') { exchanges += a; if (settings.exchangeUsesSwipe) swipesUsed += a; }
    if (e.type === 'points') pointsSpent += a;
    if (e.type === 'guest') guests += a;
  }

  // Mood of every eating day so far
  const moods = { happy: 0, worried: 0, sad: 0 };
  const weekSpend = new Map();
  for (let k = settings.start; k <= last; k = addDays(k, 1)) {
    if (isDayOff(k, settings.daysOff ?? [])) continue;
    const m = moodFor(budget(settings, live, k));
    if (m in moods) moods[m] += 1;
  }
  for (const e of live) {
    if (e.type !== 'points' || e.date < settings.start || e.date > settings.end) continue;
    const wk = startOfWeek(e.date, settings.weekStart ?? 0);
    weekSpend.set(wk, (weekSpend.get(wk) ?? 0) + (Number(e.amount) || 0));
  }

  const eatingDays = moods.happy + moods.worried + moods.sad;
  const onPace = eatingDays ? (moods.happy + moods.worried) / eatingDays : 1;
  const grade =
    onPace >= 0.95 ? ['A+', 'Pond Legend'] :
    onPace >= 0.85 ? ['A', 'Lily Pad Pro'] :
    onPace >= 0.75 ? ['B', 'Steady Hopper'] :
    onPace >= 0.6 ? ['C', 'Tadpole in Training'] :
    ['D', 'Hungry Frog'];

  let bigWeek = null;
  for (const [wk, amt] of weekSpend) if (!bigWeek || amt > bigWeek.amount) bigWeek = { week: wk, amount: round2(amt) };

  const daysLogged = new Set(live.filter((e) => !e.type.startsWith('adjust')).map((e) => e.date)).size;

  return {
    name: settings.semesterName,
    start: settings.start,
    end: settings.end,
    totals,
    swipesUsed,
    pointsSpent: round2(pointsSpent),
    exchanges,
    guests,
    leftover: { swipes: Math.round(bal.swipes), points: round2(bal.points) },
    moods,
    onPace,
    grade: grade[0],
    title: grade[1],
    bigWeek,
    daysLogged,
  };
}
