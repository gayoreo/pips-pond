import { renderPond } from './views/pond.js';
import { renderLog } from './views/log.js';
import { renderSettings } from './views/settings.js';
import { renderFavorites } from './views/favorites.js';
import { renderTutorial } from './views/tutorial.js';
import { CHANGE_EVENT } from './data/db.js';

// tab: in bottom bar · live: re-render on data change · bare: full screen, no tab bar
const routes = {
  '#/pond':      { label: 'Pond',      render: renderPond,      tab: true, live: true },
  '#/log':       { label: 'Log',       render: renderLog,       tab: true, live: true },
  '#/settings':  { label: 'Settings',  render: renderSettings,  tab: true },
  '#/favorites': { label: 'Favorites', render: renderFavorites, live: true },
  '#/welcome':   { label: 'Welcome',   render: renderTutorial,  bare: true },
};
const DEFAULT = '#/pond';

const app = document.getElementById('app');
const tabs = document.getElementById('tabs');
const current = () => (routes[location.hash] ? location.hash : DEFAULT);

function renderTabs(active) {
  const bare = Boolean(routes[active].bare);
  document.body.classList.toggle('no-tabs', bare);
  tabs.hidden = bare;
  if (bare) return;
  const tabRoutes = Object.entries(routes).filter(([, r]) => r.tab);
  tabs.style.setProperty('--tab-count', tabRoutes.length);
  tabs.innerHTML = tabRoutes
    .map(([hash, r]) => `<a href="${hash}"${hash === active ? ' aria-current="page"' : ''}>${r.label}</a>`)
    .join('');
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