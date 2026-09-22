import { startRouter, render } from './router.js';
import { getTheme, getProfile, getSettings } from './data/db.js';
import { applyTheme } from './ui/dom.js';
import { initInfo } from './ui/info.js';
import { setSoundEnabled } from './ui/sound.js';
import { runShortcut } from './views/feed.js';
import { cloudEnabled, sb, currentUser, setCachedUser } from './data/supabase.js';
import { claimDevice, syncNow, syncSoon, startAutoSync } from './data/sync.js';
import { nextStop, mayUseApp, requireLogin } from './data/auth.js';
import { captureInvite } from './views/addFriend.js';
import { lockEnabled, showLock, watchLock } from './ui/lock.js';
import { initStatus } from './ui/status.js';
// Loaded for their side effects: they register after-sync / sign-out hooks.
import './data/social.js';
import './data/push.js';

applyTheme(getTheme());
initInfo();

const goto = (hash) => history.replaceState(null, '', location.pathname + hash);
const params = new URLSearchParams(location.search);
let startUser = null;
let ready = false;

if (cloudEnabled) {
  captureInvite(params);
  try { startUser = await currentUser(); } catch { startUser = null; }
  watchAuth();
  startAutoSync();
}

const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
setSoundEnabled(settings?.sounds);

// Where do we open?
let target = null;
if (cloudEnabled && startUser) {
  const claim = await claimDevice(startUser).catch(() => 'ready');
  if (claim === 'choose') {
    target = '#/merge';
  } else {
    // Wait for the real pull before deciding where to go — racing ahead here is what used
    // to send a returning account (e.g. right after Google sign-in) into the tutorial,
    // because nextStop() would run before the synced settings had actually landed.
    // Bounded, like currentUser()'s own timeout: a stalled connection (online per the
    // browser, but not actually reachable) shouldn't hang the app open on a blank boot.
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 6000))]);
    target = await nextStop(startUser).catch(() => null);
  }
} else if (cloudEnabled && !mayUseApp()) {
  target = '#/login';
} else if (!profile.tutorialDone && !settings) {
  target = '#/welcome';
}
if (target) goto(target);

// Clean tokens / invite / shortcut params out of the address bar (keep our #route).
if (location.search) history.replaceState(null, '', location.pathname + location.hash);

// Shortcut links: ?log=swipe, ?log=points&amount=5.45, ?fav=Latte
const shortcut = (params.has('log') || params.has('fav')) && mayUseApp();
if (shortcut && !target) goto('#/pond');

await startRouter();
ready = true;
initStatus();

if (shortcut) runShortcut(params);

// Face ID / device lock
if (mayUseApp() && lockEnabled()) showLock(profile.frogName);
watchLock(async () => (await getProfile()).frogName);
window.addEventListener('pond:lock-fallback', async () => { await requireLogin(); location.hash = '#/login'; render(); });

// React to sign-in / sign-out / password-reset happening in another tab or from an email link.
function watchAuth() {
  sb().then((client) => {
    client.auth.onAuthStateChange((event, session) => {
      setCachedUser(session?.user ?? null);
      if (!ready) return; // the initial load already handled the current state
      if (event === 'PASSWORD_RECOVERY') { location.hash = '#/reset-password'; return; }
      if (event === 'SIGNED_OUT') { location.hash = '#/login'; render(); return; }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') syncSoon(200);
    });
  }).catch(() => { /* library not cached and offline: fine */ });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed:', err));
}
