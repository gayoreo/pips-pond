// Signing in and out, and deciding where to go afterwards.
import { cloudEnabled, sb, currentUser, userNow, setCachedUser, friendlyError } from './supabase.js';
import { readAll, getSettings, getProfile, saveProfile } from './db.js';
import { claimDevice, syncNow, unsyncedCount, forgetDevice } from './sync.js';
import { wipeDevice } from './db.js';

const LOCAL_ONLY = 'pips-pond:local-only';
const NEEDS_LOGIN = 'pips-pond:needs-login';
const RESETTING = 'pips-pond:resetting';
const INVITE = 'pips-pond:invite';

const flag = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setFlag = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } };

export const isLocalOnly = () => flag(LOCAL_ONLY) === '1';
export const useLocalOnly = () => setFlag(LOCAL_ONLY, '1');
export const needsLogin = () => flag(NEEDS_LOGIN) === '1';
export const appUrl = () => `${location.origin}${location.pathname}`;

// Invite links (?add=CODE) wait here until you're signed in.
export const savePendingInvite = (code) => setFlag(INVITE, code);
export const pendingInvite = () => flag(INVITE);
export const clearPendingInvite = () => setFlag(INVITE, null);

// Can the app be used right now without the sign-in screen?
// (Offline with an expired session still counts as signed in: your data is on the device.)
export function mayUseApp() {
  if (!cloudEnabled) return true;
  if (needsLogin()) return false;
  return Boolean(userNow() || readAll().owner || isLocalOnly());
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function usernameAvailable(name) {
  const { data, error } = await (await sb()).rpc('username_available', { name });
  if (error) throw error;
  return Boolean(data);
}

// ---------- sign in ----------
export async function signInWithGoogle() {
  const { error } = await (await sb()).auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: appUrl() },
  });
  if (error) throw new Error(friendlyError(error));
}

// Email or username + password.
export async function signInWithPassword(login, password) {
  const client = await sb();
  const who = login.trim();
  if (who.includes('@')) {
    const { data, error } = await client.auth.signInWithPassword({ email: who, password });
    if (error) throw new Error(friendlyError(error));
    return data.user;
  }
  const { data, error } = await client.functions.invoke('username-login', { body: { username: who, password } });
  if (error) throw new Error(friendlyError(error));
  if (data?.error) throw new Error(data.error);
  const { data: session, error: setError } = await client.auth.setSession(data);
  if (setError) throw new Error(friendlyError(setError));
  return session.user;
}

export async function signUp({ email, password, username, nickname, frogName }) {
  const { data, error } = await (await sb()).auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: appUrl(),
      data: { username: username || null, nickname, frog_name: frogName },
    },
  });
  if (error) throw new Error(friendlyError(error));
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('That email already has an account. Try signing in.');
  }
  return data; // data.session is null when email confirmation is on
}

export async function sendPasswordReset(email) {
  const { error } = await (await sb()).auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
  if (error) throw new Error(friendlyError(error));
  setFlag(RESETTING, String(Date.now()));
}

// True right after coming back from a "reset your password" email.
export function isResettingPassword() {
  const at = Number(flag(RESETTING));
  return Boolean(at && Date.now() - at < 60 * 60 * 1000);
}
export const doneResetting = () => setFlag(RESETTING, null);

export async function setPassword(password) {
  const { error } = await (await sb()).auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
}

// ---------- after signing in ----------
// Works out whose data this device holds, syncs, and returns where to go next.
export async function afterSignIn(user) {
  setCachedUser(user);
  setFlag(NEEDS_LOGIN, null);
  setFlag(LOCAL_ONLY, null);
  const claim = await claimDevice(user);
  if (claim === 'choose') return '#/merge';
  // Wait for the real pull to finish before deciding where to route — a race against a
  // timeout here can send an existing account's data through before it's actually written
  // locally, making nextStop() think there's no settings yet and show the tutorial.
  await syncNow();
  return nextStop(user);
}

export async function nextStop(user = userNow()) {
  if (isResettingPassword()) return '#/reset-password';
  const profile = await myProfile().catch(() => null);
  // Google accounts start without a username: offer to pick one (and a password) once.
  if (profile && !profile.username && !(await getProfile()).accountSetupSeen) return '#/finish-account';
  if (pendingInvite()) return '#/friends';
  if (await getSettings()) return '#/pond';
  const p = await getProfile();
  return p.tutorialDone ? '#/settings' : '#/welcome';
}

export async function markAccountSetupSeen() {
  await saveProfile({ accountSetupSeen: true });
}

export async function myProfile() {
  const user = userNow();
  if (!user) return null;
  const { data, error } = await (await sb()).from('profiles')
    .select('id, username, nickname, frog_name, friend_code').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function setUsername(username) {
  const user = userNow();
  const { error } = await (await sb()).from('profiles').update({ username }).eq('id', user.id);
  if (error) throw new Error(friendlyError(error));
}

// ---------- sign out ----------
const signOutHooks = [];
export const onSignOut = (fn) => signOutHooks.push(fn);

// Uploads what it can, then clears this device.
export async function signOut({ force = false } = {}) {
  const user = userNow();
  if (user) {
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 8000))]);
    if (!force && unsyncedCount() > 0) return { unsynced: unsyncedCount() };
    await Promise.allSettled(signOutHooks.map((fn) => fn()));
    try { await (await sb()).auth.signOut({ scope: 'local' }); } catch { /* offline: still clear below */ }
    forgetDevice(user.id);
  }
  setCachedUser(null);
  wipeDevice();
  setFlag(LOCAL_ONLY, null);
  return { unsynced: 0 };
}

// "Can't use Face ID? Sign in instead": keep the data, but ask for the password again.
export async function requireLogin() {
  setFlag(NEEDS_LOGIN, '1');
  try { await (await sb()).auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
  setCachedUser(null);
}

export { currentUser, userNow, cloudEnabled };
