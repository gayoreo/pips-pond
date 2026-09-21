import { todayKey } from '../core/dates.js';

const KEY = 'pips-pond:v1';
const THEME_KEY = 'pips-pond:theme';
export const CHANGE_EVENT = 'pond:changed';

const DEFAULT_PROFILE = { nickname: '', frogName: 'Pip', tutorialDone: false };
const empty = () => ({ settings: null, entries: [], favorites: [], profile: { ...DEFAULT_PROFILE } });

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return data ? { ...empty(), ...data } : empty();
  } catch {
    return empty();
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const newId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// ---------- settings ----------
export async function getSettings() {
  return load().settings;
}

export async function saveSettings(settings) {
  const data = load();
  data.settings = { ...settings, updatedAt: new Date().toISOString() };
  save(data);
}

// ---------- entries ----------
export async function getEntries() {
  return load().entries.filter((e) => !e.deleted);
}

export async function addEntry({ type, amount, date = todayKey(), note = '' }) {
  const now = new Date().toISOString();
  const entry = {
    id: newId(), type, amount: Number(amount), date, note,
    createdAt: now, updatedAt: now, deleted: false, synced: false,
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
  Object.assign(entry, patch, { updatedAt: new Date().toISOString(), synced: false });
  save(data);
  return entry;
}

export async function deleteEntry(id) {
  return updateEntry(id, { deleted: true });
}

// ---------- favorites ----------
export async function getFavorites() {
  return load().favorites;
}

export async function addFavorite({ name, type, amount }) {
  const data = load();
  data.favorites.push({ id: newId(), name, type, amount: Number(amount) });
  save(data);
}

export async function deleteFavorite(id) {
  const data = load();
  data.favorites = data.favorites.filter((f) => f.id !== id);
  save(data);
}

export async function moveFavorite(id, dir) {
  const data = load();
  const i = data.favorites.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= data.favorites.length) return;
  [data.favorites[i], data.favorites[j]] = [data.favorites[j], data.favorites[i]];
  save(data);
}

// ---------- profile (nickname, frog name, tutorial) ----------
export async function getProfile() {
  return { ...DEFAULT_PROFILE, ...load().profile };
}

export async function saveProfile(patch) {
  const data = load();
  data.profile = { ...DEFAULT_PROFILE, ...data.profile, ...patch };
  save(data);
}

// ---------- misc ----------
export async function resetAll() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'paper'; } catch { return 'paper'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: ignore */ }
}