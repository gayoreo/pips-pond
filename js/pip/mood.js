import { CHANGE_EVENT } from '../data/db.js';

export const MOOD_LABEL = {
  happy: 'happy', eating: 'nom nom', worried: 'worried', sad: 'sad', sleeping: 'napping',
};

export function moodFor(b) {
  if (b.phase !== 'during' || b.dayOff) return 'sleeping';
  const parts = [b.swipes, b.points].filter((p) => p.total > 0);
  if (parts.some((p) => p.leftToday < -0.004 || p.leftWeek < -0.004)) return 'sad';
  if (parts.some((p) => p.daily > 0 && p.leftToday < p.daily * 0.25)) return 'worried';
  return 'happy';
}

// Short "eating" moment after you log something.
let eatingUntil = 0;

export function startEating(ms = 1300) {
  eatingUntil = Date.now() + ms;
  setTimeout(() => window.dispatchEvent(new Event(CHANGE_EVENT)), ms + 50);
}

export const isEating = () => Date.now() < eatingUntil;