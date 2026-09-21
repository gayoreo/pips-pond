import { money, plural } from '../ui/dom.js';

const FLAVOR = {
  happy: [
    'Mmm, crunchy.', 'Save me a fry?', 'Best day on the lily pad.', 'Ribbit-tastic!',
    'Life is good on the pond.', 'I could nap in the sun forever.', 'You’re doing great.',
    'My tummy is happy.', 'Pond status: excellent.', 'Hop hop hooray!',
    'You’re doing great, {nick}!', 'Proud of you, {nick}.', 'Best pond buddy ever, {nick}.',
  ],
  worried: [
    'Getting close…', 'Maybe a light snack?', 'Let’s go easy tonight.',
    'My tummy is a little nervous.', 'Careful with the next one!', 'We can still land this.',
    'Careful, {nick}!',
  ],
  sad: [
    'Oof. Tomorrow’s budget adjusts, so we’ll be okay.', 'I’m a little overstuffed.',
    'Let’s take it slow for a bit.', 'Too many flies today…', 'It happens. We’ll bounce back.',
    'We’ll be okay, {nick}.',
  ],
  sleeping: [
    'Zzz… day off.', 'Wake me when we’re back on campus.', 'Dreaming of lily pads.',
    'Napping. Your budget is resting too.', 'Zzz… see you soon, {nick}.',
  ],
  eating: ['Nom nom nom!', 'Yum!', 'Chomp!', 'Delicious!', 'Crunch crunch!', 'Thanks, {nick}!'],
};

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

export function pipLine(mood, b, seed = 0, nick = '') {
  const pool = (FLAVOR[mood] ?? FLAVOR.happy).filter((l) => nick || !l.includes('{nick}'));
  const flavor = pool[Math.abs(seed) % pool.length].replace('{nick}', nick);
  if (mood === 'sleeping' || mood === 'eating') return flavor;
  const n = numbers(mood, b);
  return n ? `${n} ${flavor}` : flavor;
}