import { CHANGE_EVENT } from '../data/db.js';

export const MOOD_LABEL = {
  happy: 'happy', eating: 'nom nom', worried: 'worried', sad: 'sad', sleeping: 'napping', shocked: 'whoa!',
};

export function moodFor(b) {
  if (b.phase !== 'during' || b.dayOff) return 'sleeping';
  const p = b.points;
  const s = b.swipes;

  const pointsOver = p.total > 0 && (p.leftToday < -0.004 || p.leftWeek < -0.004);
  const swipesOver = s.total > 0 && s.leftWeek < 0; // swipes only care about the week
  if (pointsOver || swipesOver) return 'sad';

  if (p.total > 0 && p.daily > 0 && p.leftToday < p.daily * 0.25) return 'worried';
  return 'happy';
}

// A short reaction after you log something: 'eating' normally, 'shocked' for a big purchase.
let reaction = { mood: null, until: 0 };

export function startReaction(mood = 'eating', ms = 1300) {
  reaction = { mood, until: Date.now() + ms };
  setTimeout(() => window.dispatchEvent(new Event(CHANGE_EVENT)), ms + 50);
}

export const startEating = (ms = 1300) => startReaction('eating', ms);
export const reactionMood = () => (Date.now() < reaction.until ? reaction.mood : null);
export const isEating = () => reactionMood() !== null;
