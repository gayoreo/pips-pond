import { todayKey } from '../core/dates.js';
import { cloudEnabled, userNow, sb } from './supabase.js';

const KEY = 'pips-pond:v1';
const THEME_KEY = 'pips-pond:theme';
export const CHANGE_EVENT = 'pond:changed';

export const DEFAULT_NOTIFY = { nudge: true, nudgeTime: '19:00', pace: true, semesterEnd: true, friends: true };
const DEFAULT_PROFILE = {
  nickname: '', frogName: 'Pip', tutorialDone: false, recapSeen: '', reportSeen: '', notify: DEFAULT_NOTIFY,
};

// meta = when each part last changed on this device. pushed = the version the cloud has.
// owner = the account this data belongs to (null = never signed in).
const empty = () => ({
  settings: null, entries: [], favorites: [], profile: { ...DEFAULT_PROFILE }, archive: [],
  meta: {}, pushed: {}, owner: null,
});

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return data ? { ...empty(), ...data } : empty();
  } catch {
    return empty();
  }
}

function save(data, notify = true) {
  localStorage.setItem(KEY, JSON.stringify(data));
  if (notify) window.dispatchEvent(new Event(CHANGE_EVENT));
}

const now = () => new Date().toISOString();
const touch = (data, ...parts) => { const t = now(); for (const p of parts) data.meta[p] = t; };

export const newId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// ---------- settings ----------
export async function getSettings() {
  return load().settings;
}

export async function saveSettings(settings) {
  const data = load();
  // key = the semester's lasting id (courses stay with it). Editing a semester keeps it.
  data.settings = { ...settings, key: settings.key || data.settings?.key || newId(), updatedAt: now() };
  touch(data, 'settings');
  save(data);
}

// ---------- entries ----------
export async function getEntries() {
  return load().entries.filter((e) => !e.deleted);
}

export async function addEntry({ type, amount, date = todayKey(), time = '', note = '' }) {
  const t = now();
  const entry = {
    id: newId(), type, amount: Number(amount), date, time, note,
    createdAt: t, updatedAt: t, deleted: false, synced: false,
  };
  const data = load();
  data.entries.push(entry);
  save(data);
  return entry;
}

export async function updateEntry(id, patch) {
  const data = load();
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) return null;
  Object.assign(entry, patch, { updatedAt: now(), synced: false });
  save(data);
  return entry;
}

export async function deleteEntry(id) {
  return updateEntry(id, { deleted: true });
}

// Puts a logged entry back, for undo.
export async function restoreEntry(id) {
  return updateEntry(id, { deleted: false });
}

// Marks every current entry as deleted (kept as a "tombstone" so other devices delete it too).
function tombstoneAll(data) {
  const t = now();
  for (const e of data.entries) {
    if (!e.deleted) Object.assign(e, { deleted: true, updatedAt: t, synced: false });
  }
  // Tombstones are only needed until the cloud has them (or never, without an account).
  data.entries = data.entries.filter((e) => !e.deleted || (data.owner && !e.synced));
}

// ---------- favorites ----------
export async function getFavorites() {
  return load().favorites;
}

export async function addFavorite({ name, type, amount }) {
  const data = load();
  data.favorites.push({ id: newId(), name, type, amount: Number(amount) });
  touch(data, 'favorites');
  save(data);
}

export async function deleteFavorite(id) {
  const data = load();
  data.favorites = data.favorites.filter((f) => f.id !== id);
  touch(data, 'favorites');
  save(data);
}

export async function moveFavorite(id, dir) {
  const data = load();
  const i = data.favorites.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= data.favorites.length) return;
  [data.favorites[i], data.favorites[j]] = [data.favorites[j], data.favorites[i]];
  touch(data, 'favorites');
  save(data);
}

// ---------- profile (nickname, frog name, tutorial, notification choices) ----------
export async function getProfile() {
  const p = { ...DEFAULT_PROFILE, ...load().profile };
  return { ...p, notify: { ...DEFAULT_NOTIFY, ...(p.notify ?? {}) } };
}

export async function saveProfile(patch) {
  const data = load();
  data.profile = { ...DEFAULT_PROFILE, ...data.profile, ...patch };
  touch(data, 'prefs');
  save(data);

  // Sync to Supabase
  if (cloudEnabled && userNow()) {
    const payload = {};
    if (patch.nickname !== undefined) payload.nickname = patch.nickname;
    if (patch.frogName !== undefined) payload.frog_name = patch.frogName;
    if (patch.mood !== undefined) payload.mood = patch.mood;
    if (patch.moodAt !== undefined) payload.mood_at = patch.moodAt;
    
    // The Sandshrew companion toggle
    if (patch.companion !== undefined) payload.companion = patch.companion; 

    if (Object.keys(payload).length > 0) {
      // Connect to Supabase and send the payload
      sb().then(client => client.from('profiles').update(payload).eq('id', userNow().id).then());
    }
  }
}

// ---------- semesters ----------
// Other semesters (past, future, or just swapped out): [{ id, settings, entries, closedAt? }]
// closedAt is set when a semester is swapped out of "current"; a future semester added
// ahead of time (never yet current) won't have one.
export async function getArchive() {
  return load().archive;
}

// Moves the current semester (settings + entries) into the archive and starts a new one.
export async function startNewSemester(nextSettings) {
  const data = load();
  if (data.settings) {
    data.archive.push({
      id: newId(),
      settings: data.settings,
      entries: data.entries.filter((e) => !e.deleted).map(({ synced, ...e }) => e),
      closedAt: now(),
    });
  }
  tombstoneAll(data);
  data.settings = { ...nextSettings, key: newId(), updatedAt: now() };
  touch(data, 'settings', 'archive');
  save(data);
}

// Adds a semester without disturbing the current one — for setting up a future
// semester ahead of time. Not switched to; just sits in the archive until you do.
export async function addFutureSemester(settings) {
  const data = load();
  data.archive.push({ id: newId(), settings: { ...settings, key: newId(), updatedAt: now() }, entries: [] });
  touch(data, 'archive');
  save(data);
  return data.archive[data.archive.length - 1].id;
}

// Swaps the current semester with one sitting in the archive (past or future).
// The outgoing semester takes the archive slot the incoming one just vacated, so
// nothing is lost — you can freely switch back and forth. Only one semester is
// ever "live" for logging at a time; the other keeps its own entries, frozen.
export async function switchSemester(id) {
  const data = load();
  const i = data.archive.findIndex((a) => a.id === id);
  if (i < 0 || !data.settings) return;
  const incoming = data.archive[i];
  const outgoing = {
    id: newId(),
    settings: data.settings,
    entries: data.entries.filter((e) => !e.deleted).map(({ synced, ...e }) => e),
    closedAt: now(),
  };
  data.archive[i] = outgoing;
  tombstoneAll(data); // clears the outgoing semester's entries from the live array (as tombstones, for sync)
  data.entries.push(...incoming.entries.map((e) => ({ ...e, synced: false })));
  data.settings = { ...incoming.settings, updatedAt: now() };
  touch(data, 'settings', 'archive');
  save(data);
}

// The current semester's lasting id, made the first time it's needed.
export function semesterKey() {
  const data = load();
  if (!data.settings) return '';
  if (!data.settings.key) {
    data.settings = { ...data.settings, key: newId() };
    touch(data, 'settings');
    save(data);
  }
  return data.settings.key;
}

// ---------- bulk (import / export) ----------
export async function addEntries(list) {
  const t = now();
  const data = load();
  for (const e of list) {
    data.entries.push({
      id: newId(), type: e.type, amount: Number(e.amount), date: e.date, time: e.time ?? '', note: e.note ?? '',
      createdAt: t, updatedAt: t, deleted: false, synced: false,
    });
  }
  save(data);
  return list.length;
}

export async function exportAll() {
  const { meta, pushed, owner, ...data } = load();
  return {
    app: 'pips-pond', version: 1, exportedAt: now(), ...data,
    entries: data.entries.filter((e) => !e.deleted).map(({ synced, ...e }) => e),
  };
}

// Restoring a backup replaces everything (and, when signed in, your cloud copy too).
export async function importAll(backup) {
  if (!backup || typeof backup !== 'object' || !Array.isArray(backup.entries)) {
    throw new Error('That file isn’t a Pip’s Pond backup.');
  }
  const data = load();
  tombstoneAll(data);
  const t = now();
  const restored = backup.entries
    .filter((e) => e && e.id && e.type && e.date)
    .map((e) => ({ ...e, amount: Number(e.amount), note: e.note ?? '', updatedAt: t, deleted: Boolean(e.deleted), synced: false }));
  const ids = new Set(restored.map((e) => e.id));
  data.entries = [...data.entries.filter((e) => !ids.has(e.id)), ...restored];
  data.settings = backup.settings ?? null;
  data.favorites = Array.isArray(backup.favorites) ? backup.favorites : [];
  data.archive = Array.isArray(backup.archive) ? backup.archive : [];
  data.profile = { ...DEFAULT_PROFILE, ...(backup.profile ?? {}) };
  touch(data, 'settings', 'favorites', 'archive', 'prefs');
  save(data);
}

// ---------- misc ----------
// Erase everything. When signed in, the erase syncs to your other devices too.
export async function resetAll() {
  const data = load();
  tombstoneAll(data);
  const fresh = { ...empty(), entries: data.entries, owner: data.owner, pushed: data.pushed };
  touch(fresh, 'settings', 'favorites', 'archive', 'prefs');
  save(fresh);
}

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'paper'; } catch { return 'paper'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: ignore */ }
}

// ---------- for sync (whole-store access) ----------
export const readAll = () => load();
export const writeAll = (data, notify = true) => save(data, notify);
export function wipeDevice() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
