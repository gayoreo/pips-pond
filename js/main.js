import { startRouter } from './router.js';
import { getTheme, getProfile, getSettings } from './data/db.js';
import { applyTheme } from './ui/dom.js';

applyTheme(getTheme());

// First launch → tutorial
const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
if (!profile.tutorialDone && !settings) history.replaceState(null, '', '#/welcome');

startRouter();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed:', err));
}