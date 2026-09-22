// Keeps this device and your account in step. Everything is saved on the device first,
// so logging works offline; sync sends and fetches changes whenever it can.
// Conflicts: the most recent edit wins.
import { cloudEnabled, sb, userNow, currentUser, friendlyError } from './supabase.js';
import { readAll, writeAll, wipeDevice, CHANGE_EVENT } from './db.js';
import { budget } from '../core/calc.js';
import { todayKey } from '../core/dates.js';
import { moodFor } from '../pip/mood.js';

export const SYNC_EVENT = 'pond:sync';
const PARTS = { settings: 'settings', favorites: 'favorites', archive: 'archive', prefs: 'profile', study: 'study' };
const pullKey = (uid) => `pips-pond:pulled:${uid}`;
const PUBLISHED_KEY = 'pips-pond:published';

const hooks = []; // extra steps after each sync (friends, notifications)
export const afterSync = (fn) => hooks.push(fn);

export const syncState = { status: 'idle', at: null, error: '' };
function setState(status, error = '') {
  Object.assign(syncState, { status, error });
  if (status === 'synced') syncState.at = new Date();
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { ...syncState } }));
}

// ---------- pure helpers (unit tested) ----------
const ms = (t) => (t ? Date.parse(t) : 0);

export const rowFromEntry = (e) => ({
  id: e.id, type: e.type, amount: Number(e.amount), date: e.date, time: e.time || null, note: e.note ?? '',
  created_at: e.createdAt, updated_at: e.updatedAt, deleted: Boolean(e.deleted),
});

export const entryFromRow = (r) => ({
  id: r.id, type: r.type, amount: Number(r.amount), date: String(r.date).slice(0, 10), time: r.time ?? '', note: r.note ?? '',
  createdAt: r.created_at, updatedAt: r.updated_at, deleted: Boolean(r.deleted), synced: true,
});

// Merges rows fetched from the cloud into the device's entries.
// replaceCloud: this device's pond replaces the account's, so cloud-only entries get deleted.
export function mergeEntries(local, rows, { replaceCloud = false, stamp = new Date().toISOString() } = {}) {
  const byId = new Map(local.map((e) => [e.id, e]));
  let changed = false;
  for (const row of rows) {
    const mine = byId.get(row.id);
    if (!mine) {
      if (row.deleted) continue;
      if (replaceCloud) {
        byId.set(row.id, { ...entryFromRow(row), deleted: true, updatedAt: stamp, synced: false });
      } else {
        byId.set(row.id, entryFromRow(row));
        changed = true;
      }
      continue;
    }
    if (mine.synced || ms(row.updated_at) >= ms(mine.updatedAt)) {
      const theirs = entryFromRow(row);
      if (theirs.deleted) byId.delete(row.id);
      else byId.set(row.id, theirs);
      if (!mine.synced || mine.deleted !== theirs.deleted || mine.amount !== theirs.amount ||
          mine.date !== theirs.date || mine.time !== theirs.time || mine.type !== theirs.type ||
          mine.note !== theirs.note) changed = true;
    }
  }
  return { entries: [...byId.values()], changed };
}

// Settings, favorites, past semesters and profile: newest copy wins.
// Returns the merged data and which parts need uploading.
export function mergeParts(data, row) {
  const out = { ...data, meta: { ...data.meta }, pushed: { ...data.pushed } };
  const push = [];
  let changed = false;
  for (const [part, field] of Object.entries(PARTS)) {
    const remoteAt = row?.[`${part}_at`] ?? null;
    const localAt = out.meta[part] ?? null;
    if (remoteAt && (!localAt || ms(remoteAt) > ms(localAt))) {
      out[field] = row[part] ?? (field === 'settings' ? null : field === 'profile' ? {} : []);
      out.meta[part] = remoteAt;
      out.pushed[part] = remoteAt;
      changed = true;
    } else if (localAt && ms(localAt) !== ms(out.pushed[part])) {
      push.push(part);
    }
  }
  return { data: out, push, changed };
}

// ---------- claiming this device for an account ----------
const hasPond = (d) => Boolean(d.settings || d.entries.some((e) => !e.deleted) || d.favorites.length || d.archive.length);

// Returns 'ready' or 'choose' (this device and the account both have a pond).
export async function claimDevice(user) {
  const data = readAll();
  if (data.owner === user.id) return 'ready';
  if (data.owner && data.owner !== user.id) {
    // Someone else's data (they didn't sign out properly). Start clean for this account.
    wipeDevice();
    writeAll({ ...readAll(), owner: user.id }, false);
    return 'ready';
  }
  if (!hasPond(data)) {
    writeAll({ ...data, owner: user.id }, false);
    return 'ready';
  }
  const client = await sb();
  const [{ data: state }, { count }] = await Promise.all([
    client.from('user_state').select('settings, archive').maybeSingle(),
    client.from('entries').select('id', { count: 'exact', head: true }).eq('deleted', false),
  ]);
  const cloudHasPond = Boolean(state?.settings || state?.archive?.length || count);
  if (!cloudHasPond) {
    adoptLocal(user.id, false);
    return 'ready';
  }
  return 'choose';
}

// keep = 'cloud' (use the account's pond) or 'device' (upload this device's pond instead).
export function resolveClaim(uid, keep) {
  if (keep === 'cloud') {
    wipeDevice();
    writeAll({ ...readAll(), owner: uid }, false);
  } else {
    adoptLocal(uid, true);
  }
}

function adoptLocal(uid, replaceCloud) {
  const data = readAll();
  const stamp = new Date().toISOString();
  for (const part of Object.keys(PARTS)) data.meta[part] = stamp; // newest → uploads over the cloud copy
  data.pushed = {};
  data.entries = data.entries.map((e) => ({ ...e, synced: false }));
  data.owner = uid;
  data.replaceCloud = replaceCloud;
  localStorage.removeItem(pullKey(uid));
  writeAll(data, false);
}

// ---------- the sync itself ----------
let running = null;
let again = false;

export function syncNow() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await syncOnce(); } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

let soonTimer = null;
export function syncSoon(delay = 1500) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(syncNow, delay);
}

async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function syncOnce() {
  if (!cloudEnabled) return;
  // No session yet? (e.g. the app opened offline and couldn't refresh it) Try again now.
  const user = userNow() ?? (readAll().owner && navigator.onLine ? await currentUser() : null);
  if (!user) { setState(readAll().owner && !navigator.onLine ? 'offline' : 'signed-out'); return; }
  if (readAll().owner !== user.id) return; // waiting for claimDevice
  if (!navigator.onLine) { setState('offline'); return; }
  setState('syncing');
  try {
    const client = await sb();
    const replaceCloud = Boolean(readAll().replaceCloud);

    // 1. Fetch what changed in the cloud (with a minute of overlap, in case of slow writes elsewhere).
    const since = replaceCloud ? null : localStorage.getItem(pullKey(user.id));
    const sinceSafe = since ? new Date(Date.parse(since) - 60_000).toISOString() : '1970-01-01T00:00:00Z';
    const rows = await fetchAll(() => client.from('entries')
      .select('id, type, amount, date, time, note, created_at, updated_at, deleted, synced_at')
      .gt('synced_at', sinceSafe).order('synced_at'));
    const { data: state, error: stateError } = await client.from('user_state').select('*').maybeSingle();
    if (stateError) throw stateError;

    // 2. Merge into the device (re-read first, in case something was logged while we waited).
    let data = readAll();
    const merged = mergeEntries(data.entries, rows, { replaceCloud });
    const parts = mergeParts({ ...data, entries: merged.entries }, state);
    data = { ...parts.data, replaceCloud: false };
    quiet = true;
    try { writeAll(data, merged.changed || parts.changed); } finally { quiet = false; }
    const newest = rows.reduce((max, r) => (ms(r.synced_at) > ms(max) ? r.synced_at : max), since);
    if (newest) localStorage.setItem(pullKey(user.id), newest);

    // 3. Upload entries changed on this device.
    const dirty = data.entries.filter((e) => !e.synced);
    for (let i = 0; i < dirty.length; i += 500) {
      const chunk = dirty.slice(i, i + 500);
      const { error } = await client.from('entries').upsert(chunk.map(rowFromEntry), { onConflict: 'id' });
      if (error) throw error;
      const sent = new Map(chunk.map((e) => [e.id, e.updatedAt]));
      const now = readAll();
      now.entries = now.entries
        .map((e) => (sent.get(e.id) === e.updatedAt ? { ...e, synced: true } : e))
        .filter((e) => !(e.deleted && e.synced));
      writeAll(now, false);
    }

    // 4. Upload settings / favorites / past semesters / profile if they changed here.
    if (parts.push.length) {
      const fresh = readAll();
      const row = { updated_at: new Date().toISOString() };
      for (const part of parts.push) {
        row[part] = fresh[PARTS[part]];
        row[`${part}_at`] = fresh.meta[part];
      }
      const { error } = await client.from('user_state').upsert({ user_id: user.id, ...row }, { onConflict: 'user_id' });
      if (error) throw error;
      const after = readAll();
      for (const part of parts.push) after.pushed[part] = row[`${part}_at`];
      writeAll(after, false);
    }

    await publishProfile(client, user);
    for (const hook of hooks) {
      try { await hook(client, user); } catch (err) { console.warn('Sync extra step failed:', err); }
    }
    setState('synced');
  } catch (err) {
    console.warn('Sync failed:', err);
    if (!navigator.onLine || /fetch|network/i.test(String(err?.message))) setState('offline');
    else setState('error', friendlyError(err));
  }
}

// Friends see your names and your frog's mood (nothing else).
async function publishProfile(client, user) {
  const data = readAll();
  let mood = 'sleeping';
  if (data.settings) {
    const b = budget(data.settings, data.entries.filter((e) => !e.deleted), todayKey());
    mood = moodFor(b);
  }
  const pub = { nickname: data.profile?.nickname ?? '', frog_name: data.profile?.frogName || 'Pip', mood };
  const key = `${user.id}:${JSON.stringify(pub)}:${todayKey()}`;
  if (localStorage.getItem(PUBLISHED_KEY) === key) return;
  const { error } = await client.from('profiles').update({ ...pub, mood_at: new Date().toISOString() }).eq('id', user.id);
  if (error) throw error;
  localStorage.setItem(PUBLISHED_KEY, key);
}

export function unsyncedCount() {
  return readAll().entries.filter((e) => !e.synced).length;
}

// Sync after changes, when coming back online / to the app, and every minute while open.
let started = false;
let quiet = false; // true while sync itself is saving (so that doesn't trigger another sync)
export function startAutoSync() {
  if (started || !cloudEnabled) return;
  started = true;
  window.addEventListener(CHANGE_EVENT, () => { if (!quiet) syncSoon(); });
  window.addEventListener('online', () => syncSoon(200));
  window.addEventListener('offline', () => setState('offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(200); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60_000);
}

export function forgetDevice(uid) {
  localStorage.removeItem(pullKey(uid));
  localStorage.removeItem(PUBLISHED_KEY);
}
