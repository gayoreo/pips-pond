import { startRouter } from './router.js';
import { getTheme, getProfile, getSettings } from './data/db.js';
import { applyTheme } from './ui/dom.js';
import { initInfo } from './ui/info.js';
import { setSoundEnabled } from './ui/sound.js';
import { runShortcut } from './views/feed.js';

applyTheme(getTheme());
initInfo();

const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
setSoundEnabled(settings?.sounds);

// First launch → tutorial
if (!profile.tutorialDone && !settings) history.replaceState(null, '', `${location.pathname}#/welcome`);

// Shortcut links: ?log=swipe, ?log=points&amount=5.45, ?fav=Latte
const params = new URLSearchParams(location.search);
if (params.has('log') || params.has('fav')) {
  history.replaceState(null, '', `${location.pathname}#/pond`);
  await startRouter();
  runShortcut(params);
} else {
  startRouter();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed:', err));
}
