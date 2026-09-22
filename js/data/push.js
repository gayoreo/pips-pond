// Push notifications: daily nudge, pace alerts, semester-end warnings and friend pings.
// The phone only gets pushes from the server; this file turns them on/off for this device
// and tells the server what it needs to know (your reminder time, time zone and a budget snapshot).
import { VAPID_PUBLIC_KEY } from '../config.js';
import { cloudEnabled, sb, userNow, friendlyError } from './supabase.js';
import { readAll } from './db.js';
import { afterSync } from './sync.js';
import { onSignOut } from './auth.js';
import { budget } from '../core/calc.js';
import { todayKey } from '../core/dates.js';

const PUBLISHED = 'pips-pond:notify-published';
const LOG_TYPES = new Set(['swipe', 'points', 'exchange', 'guest']);

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// 'unavailable' | 'needs-account' | 'needs-install' | 'unsupported' | 'denied' | 'off' | 'on'
export async function pushStatus() {
  if (!cloudEnabled || !VAPID_PUBLIC_KEY) return 'unavailable';
  if (!userNow()) return 'needs-account';
  if (isIOS() && !isInstalled()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

const keyBytes = (b64) => {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// Must be called from a tap (iPhone requires it).
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your phone’s Settings → Notifications → Pip’s Pond.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const { error } = await (await sb()).rpc('save_push_subscription', {
    endpoint: json.endpoint, p256dh: json.keys.p256dh, auth_key: json.keys.auth,
  });
  if (error) throw new Error(friendlyError(error));
  localStorage.removeItem(PUBLISHED);
  await publishNotifyState(await sb(), userNow());
}

export async function disablePush() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await (await sb()).rpc('delete_push_subscription', { endpoint: sub.endpoint }); } catch { /* offline */ }
  await sub.unsubscribe();
}

export async function sendTestPush() {
  const { data, error } = await (await sb()).functions.invoke('send-push', { body: { test: true } });
  if (error) throw new Error(friendlyError(error));
  if (data?.error) throw new Error(data.error);
  return data?.sent ?? 0;
}

// What the reminder robot needs. Only sent when it changes.
function notifyState(data) {
  const profile = data.profile ?? {};
  const s = data.settings;
  const entries = data.entries.filter((e) => !e.deleted);
  const lastLogDay = entries.filter((e) => LOG_TYPES.has(e.type)).reduce((m, e) => (e.date > m ? e.date : m), '');
  let snapshot = null;
  if (s) {
    const b = budget(s, entries, todayKey());
    snapshot = {
      day: todayKey(),
      weekStart: b.weekStart,
      lastLogDay,
      pointsLeftWeek: Math.round(b.points.leftWeek * 100) / 100,
      swipesLeftWeek: b.swipes.leftWeek,
      pointsBalance: Math.round(b.points.balance * 100) / 100,
      swipesBalance: b.swipes.balance,
      pointsTotal: b.points.total,
      swipesTotal: b.swipes.total,
      pointsRollover: Boolean(s.pointsRollover),
      swipesRollover: Boolean(s.swipesRollover),
    };
  }
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    prefs: { ...(profile.notify ?? {}), frogName: profile.frogName || 'Pip', nickname: profile.nickname || '' },
    semester: s ? { name: s.semesterName, start: s.start, end: s.end, daysOff: s.daysOff ?? [] } : null,
    snapshot,
  };
}

async function publishNotifyState(client, user) {
  if (!user || !VAPID_PUBLIC_KEY) return;
  const state = notifyState(readAll());
  const key = `${user.id}:${JSON.stringify(state)}`;
  if (localStorage.getItem(PUBLISHED) === key) return;
  const { error } = await client.from('notify_state')
    .upsert({ user_id: user.id, ...state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  localStorage.setItem(PUBLISHED, key);
}

afterSync(publishNotifyState);
onSignOut(async () => {
  localStorage.removeItem(PUBLISHED);
  await disablePush();
});
