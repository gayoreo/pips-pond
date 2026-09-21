import { todayKey } from '../core/dates.js';

const KEY = 'pips-pond:v1';
const THEME_KEY = 'pips-pond:theme';
export const CHANGE_EVENT = 'pond:changed';

const empty = () => ({ settings: null, entries: [] });

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? empty();
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

export async function getSettings() {
  return load().settings;
}

export async function saveSettings(settings) {
  const data = load();
  data.settings = { ...settings, updatedAt: new Date().toISOString() };
  save(data);
}

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
  return updateEntry(id, { deleted: true }); // soft delete, so sync can pass it along later
}

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