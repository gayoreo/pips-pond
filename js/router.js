import { renderPond } from './views/pond.js';
import { renderLog } from './views/log.js';
import { renderSettings } from './views/settings.js';
import { renderFavorites } from './views/favorites.js';
import { CHANGE_EVENT } from './data/db.js';

// tab: shows in the bottom bar · live: re-renders when data changes
const routes = {
  '#/pond':      { label: 'Pond',      render: renderPond,      tab: true, live: true },
  '#/log':       { label: 'Log',       render: renderLog,       tab: true, live: true },
  '#/settings':  { label: 'Settings',  render: renderSettings,  tab: true },
  '#/favorites': { label: 'Favorites', render: renderFavorites, live: true },
};
const DEFAULT = '#/pond';

const app = document.getElementById('app');
const tabs = document.getElementById('tabs');
const current = () => (routes[location.hash] ? location.hash : DEFAULT);

function renderTabs(active) {
  const tabRoutes = Object.entries(routes).filter(([, r]) => r.tab);
  tabs.style.setProperty('--tab-count', tabRoutes.length);
  tabs.innerHTML = tabRoutes
    .map(([hash, r]) => `<a href="${hash}"${hash === active ? ' aria-current="page"' : ''}>${r.label}</a>`)
    .join('');
  tabs.hidden = false;
}

let queue = Promise.resolve();

export function render() {
  queue = queue
    .then(async () => {
      const hash = current();
      renderTabs(hash);
      await routes[hash].render(app);
    })
    .catch((err) => {
      console.error(err);
      app.innerHTML = '<p class="hand">Something went wrong. Check the browser console (F12).</p>';
    });
  return queue;
}

export function startRouter() {
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  window.addEventListener(CHANGE_EVENT, () => { if (routes[current()].live) render(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && routes[current()].live) render();
  });
  if (!routes[location.hash]) history.replaceState(null, '', DEFAULT);
  return render();
}