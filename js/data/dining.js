// Dining halls and cafés: hours and daily menus, fetched each morning by the "dining" server
// function and read here. A copy is kept on this device so it still works offline.
import { sb, cloudEnabled } from './supabase.js';
import { dayOfWeek } from '../core/dates.js';

const CACHE_KEY = 'pips-pond:dining';

export function cachedDining() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch { return null; }
}

export const WEEK = 7; // days of menus kept on the device

// { places: [...], menus: { 'YYYY-MM-DD': { slug: [meals] } }, updatedAt }
export async function loadDining(days) {
  const old = cachedDining() ?? { places: [], menus: {}, updatedAt: '' };
  if (!cloudEnabled) return old;
  const { data, error } = await (await sb()).from('dining_cache').select('key, data, updated_at').in('key', ['places', ...days.map((d) => `menu:${d}`)]);
  if (error) throw error;
  const out = { places: old.places, menus: {}, updatedAt: old.updatedAt };
  for (const d of days) if (old.menus?.[d]) out.menus[d] = old.menus[d];
  for (const row of data ?? []) {
    if (row.key === 'places') { out.places = row.data?.places ?? []; out.updatedAt = row.updated_at; }
    else out.menus[row.key.slice(5)] = row.data ?? {};
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch { /* storage full; fine */ }
  return out;
}

// Opening times on one date: seasonal hours win over the usual ones. [{ start, end, allDay, label }]
export function hoursOn(place, day) {
  const dow = dayOfWeek(day);
  for (const s of place.seasonal ?? []) {
    if (s.from && s.to && day >= s.from && day <= s.to) {
      const row = (s.rows ?? []).find((r) => r.days.includes(dow));
      return row ? row.slots : [];
    }
  }
  return (place.standard ?? []).find((r) => r.days.includes(dow))?.slots ?? [];
}

// Open right now? { open, until, next, allDay }
export function statusAt(place, day, hm) {
  const slots = hoursOn(place, day);
  if (slots.some((s) => s.allDay)) return { open: true, allDay: true };
  const on = slots.find((s) => s.start <= hm && (s.end > hm || s.end < s.start));
  if (on) return { open: true, until: on.end };
  const next = slots.filter((s) => s.start > hm).sort((a, b) => a.start.localeCompare(b.start))[0];
  return { open: false, next: next?.start ?? '' };
}

// Is the place open for all of start..end (or at least at start)?
export const openAt = (place, day, hm) => statusAt(place, day, hm).open;

// Which meal to show first, by the time of day.
export function mealNow(meals, hm) {
  const names = meals.map((m) => m.meal.toLowerCase());
  const want = hm < '10:30' ? ['breakfast'] : hm < '16:00' ? ['lunch', 'brunch'] : ['dinner'];
  const i = names.findIndex((n) => want.some((w) => n.includes(w)));
  return i >= 0 ? i : 0;
}
