// Pond friends: requests, the friends list, and snacks / cheers / visits / dances.
// Friends only ever see your nickname, username, frog's name and frog's mood.
import { sb, userNow, friendlyError } from './supabase.js';
import { afterSync } from './sync.js';
import { onSignOut } from './auth.js';

export const FRIENDS_EVENT = 'pond:friends';
export const PINGS_EVENT = 'pond:pings';

export const PING_KINDS = {
  snack: { label: 'snack', verb: 'Send a snack' },
  cheer: { label: 'cheer', verb: 'Cheer' },
  visit: { label: 'visit', verb: 'Visit' },
  dance: { label: 'dance', verb: 'Silly dance' },
};

const state = { friends: [], pings: [], schedules: {}, loaded: false };
export const friendsNow = () => state.friends;
export const pingsNow = () => state.pings;
export const scheduleOf = (id) => state.schedules[id] ?? null;
export const incomingCount = () => state.friends.filter((f) => f.status === 'incoming').length;

async function call(fn, args) {
  const { data, error } = await (await sb()).rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function refreshFriends() {
  if (!userNow()) return state.friends;
  const fresh = (await call('my_friends')) ?? [];
  const changed = !state.loaded || JSON.stringify(fresh) !== JSON.stringify(state.friends);
  state.friends = fresh;
  state.loaded = true;
  if (changed) window.dispatchEvent(new Event(FRIENDS_EVENT));
  return state.friends;
}

// Class schedules your friends chose to share: { friendId: [meetings] }
export async function refreshSchedules() {
  if (!userNow()) return state.schedules;
  const rows = (await call('friend_schedules')) ?? [];
  const fresh = Object.fromEntries(rows.map((r) => [r.id, r.schedule]));
  const changed = JSON.stringify(fresh) !== JSON.stringify(state.schedules);
  state.schedules = fresh;
  if (changed) window.dispatchEvent(new Event(FRIENDS_EVENT));
  return fresh;
}

export async function refreshPings() {
  if (!userNow()) return state.pings;
  const fresh = (await call('my_pings')) ?? [];
  const before = state.pings.map((p) => p.id).join();
  state.pings = fresh;
  if (fresh.map((p) => p.id).join() !== before) window.dispatchEvent(new Event(PINGS_EVENT));
  return state.pings;
}

// status: sent | accepted | already | pending | not_found | self
export async function sendFriendRequest(target) {
  const status = await call('send_friend_request', { target });
  await refreshFriends();
  return status;
}

export async function respondToRequest(id, accept) {
  await call('respond_friend_request', { other: id, accept });
  return refreshFriends();
}

export async function removeFriend(id) {
  await call('remove_friend', { other: id });
  return refreshFriends();
}

// Sends a snack / cheer / visit / dance / study invite (note = suggested time), then asks the server to push a notification to them.
export async function sendPing(friendId, kind, note = null) {
  let id;
  try {
    id = await call('send_ping', { friend: friendId, what: kind, note });
  } catch (err) {
    if (/slow_down/.test(err.message)) throw new Error('You just sent one! Try again in a few minutes.');
    throw err;
  }
  (await sb()).functions.invoke('send-push', { body: { ping: id } }).catch(() => { /* notifications are a bonus */ });
  return id;
}

export async function markPingsSeen(ids) {
  if (!ids.length) return;
  state.pings = state.pings.filter((p) => !ids.includes(p.id));
  window.dispatchEvent(new Event(PINGS_EVENT));
  try { await call('mark_pings_seen', { ids }); } catch { /* will show again next time; harmless */ }
}

export function clearSocial() {
  state.friends = [];
  state.pings = [];
  state.schedules = {};
  state.loaded = false;
}

// Who sent it, in words: "Sam" or "@sam"
export const whoName = (p) => p.nickname || (p.username ? `@${p.username}` : 'A friend');

afterSync(async () => {
  await Promise.all([refreshPings(), refreshFriends(), refreshSchedules().catch(() => {})]);
});
onSignOut(clearSocial);
