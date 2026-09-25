import { money, plural } from '../ui/dom.js';

// {nick} lines only show once you've set a nickname.
const FLAVOR = {
  happy: [
    'Mmm, crunchy.', 'Save me a fry?', 'Best day on the lily pad.', 'Ribbit-tastic!',
    'Life is good on the pond.', 'I could nap in the sun forever.', 'You’re doing great.',
    'My tummy is happy.', 'Pond status: excellent.', 'Hop hop hooray!',
    'Feeling hoppy!', 'Not a ripple out of place.', 'We make a great team.',
    'Budget? Handled.', 'I’d give today five lily pads.', 'Tiny frog, big plans.',
    'Look at us, being responsible!', 'Snack wisely, my friend.', 'Croak of approval.',
    'You’re doing great, {nick}!', 'Proud of you, {nick}.', 'Best pond buddy ever, {nick}.',
    'High five, {nick}! …well, high webbed-foot.',
  ],
  worried: [
    'Getting close…', 'Maybe a light snack?', 'Let’s go easy tonight.',
    'My tummy is a little nervous.', 'Careful with the next one!', 'We can still land this.',
    'Water’s getting shallow…', 'Maybe the dining hall instead?', 'Deep breaths. Ribbit.',
    'A small one, maybe?', 'Careful, {nick}!', 'We’ve got this, {nick}. Carefully.',
  ],
  sad: [
    'Oof. Tomorrow’s budget adjusts, so we’ll be okay.', 'I’m a little overstuffed.',
    'Let’s take it slow for a bit.', 'Too many flies today…', 'It happens. We’ll bounce back.',
    'Tomorrow is a fresh lily pad.', 'I’ll just… sit here a moment.', 'Budget re-balances overnight. Promise.',
    'We’ll be okay, {nick}.', 'Chin up, {nick}. Frogs are resilient.',
  ],
  sleeping: [
    'Zzz… day off.', 'Wake me when we’re back on campus.', 'Dreaming of lily pads.',
    'Napping. Your budget is resting too.', 'Zzz… five more minutes.', 'Snoozing on a sunny rock.',
    'Zzz… see you soon, {nick}.',
  ],
  eating: [
    'Nom nom nom!', 'Yum!', 'Chomp!', 'Delicious!', 'Crunch crunch!', 'Gulp!',
    'Tasty!', 'Mmm, fancy.', 'Thanks, {nick}!',
  ],
  shocked: [
    'Whoa! That’s more than today’s whole budget!', 'Big spender alert!',
    'That was a feast! I’ll re-balance tomorrow.', 'Holy lily pads!',
  ],
};

const TIME = {
  morning: ['Good morning! Breakfast time?', 'Rise and ribbit!', 'Morning, {nick}!'],
  lunch: ['Lunch o’clock!', 'My tummy says it’s noon.', 'Lunch break, {nick}?'],
  evening: ['Dinner plans?', 'Evening croaks are the best croaks.', 'What’s for dinner, {nick}?'],
  late: ['It’s late… sleepy frog.', 'Midnight snack? Be careful…', 'Go to bed, {nick}! …after you log.'],
};

const STREAK = [
  '{streak} days on pace! Look at us!', '{streak}-day streak! I’m so proud.',
  'On pace {streak} days in a row!', '{streak} days straight, {nick}! Legendary.',
];

const FINALS = [
  'Finals mode! We have extra to use, so treat yourself.', 'Spend-down time! Use those swipes.',
  'Finals fuel! Grab a snack, you earned it.', 'Last stretch, {nick}! Eat well for exams.',
];

export const PET = [
  'Hehe, that tickles!', 'Ribbit!', '*happy wiggle*', 'Again! Again!', 'Pat pat pat.',
  'You found my favorite spot!', 'Boing!', '*blinks slowly*', 'Hi, {nick}!',
];

export const SANDSHREW_PET = [
  "Sand-shh!",
  "Scrunch!",
  "Digging the vibe.",
  "*happy digging noises*",
  "Clack clack!",
  "So cozy in the sun.",
  "Armor is fully polished.",
];

export function timeOfDay(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'lunch';
  if (hour >= 17 && hour < 22) return 'evening';
  if (hour >= 22 || hour < 5) return 'late';
  return null;
}

export function pick(pool, seed, nick = '', extra = {}) {
  const usable = pool.filter((l) => nick || !l.includes('{nick}'));
  let line = usable[Math.abs(seed) % usable.length] ?? '';
  line = line.replace('{nick}', nick);
  for (const [k, v] of Object.entries(extra)) line = line.replace(`{${k}}`, v);
  return line;
}

function numbers(mood, b) {
  const p = b.points;
  const s = b.swipes;
  if (mood === 'sad') {
    if (p.total > 0 && p.leftToday < -0.004) return `${money(-p.leftToday)} over today.`;
    if (s.total > 0 && s.leftWeek < 0) return `${plural(-s.leftWeek, 'swipe')} over this week.`;
    return `${money(-p.leftWeek)} over this week.`;
  }
  const bits = [];
  if (p.total > 0) bits.push(money(Math.max(0, p.leftToday)));
  if (s.total > 0) bits.push(plural(Math.max(0, s.leftToday), 'swipe'));
  return bits.length ? `${bits.join(' and ')} left today!` : '';
}

/**
 * What the frog says on the Pond.
 * ctx: { seed, nick, hour, streak, finals }
 */
export function pipLine(mood, b, ctx = {}) {
  const { seed = 0, nick = '', hour = new Date().getHours(), streak = 0, finals = false } = ctx;
  if (mood === 'sleeping' || mood === 'eating' || mood === 'shocked') {
    return pick(FLAVOR[mood], seed, nick);
  }

  // Mix in special pools on happy days.
  const pools = [FLAVOR[mood] ?? FLAVOR.happy];
  const tod = timeOfDay(hour);
  if (mood !== 'sad' && tod) pools.push(TIME[tod]);
  if (mood === 'happy' && streak >= 3) pools.push(STREAK, STREAK);
  if (mood !== 'sad' && finals) pools.push(FINALS, FINALS);
  const pool = pools[Math.abs(seed * 7 + hour) % pools.length];

  const flavor = pick(pool, seed, nick, { streak: String(streak) });
  const n = numbers(mood, b);
  return n ? `${n} ${flavor}` : flavor;
}
