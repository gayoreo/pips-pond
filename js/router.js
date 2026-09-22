import { renderPond } from './views/pond.js';
import { renderLog } from './views/log.js';
import { renderSettings } from './views/settings.js';
import { renderFavorites } from './views/favorites.js';
import { renderTutorial, renderSetup } from './views/tutorial.js';
import { renderSemesters } from './views/semesters.js';
import { renderData } from './views/data.js';
import { renderLogin, renderResetPassword, renderMerge } from './views/login.js';
import { renderSignup, renderFinishAccount } from './views/signup.js';
import { renderFriends } from './views/friends.js';
import { renderStudy } from './views/study.js';
import { renderCourseSetup } from './views/courseSetup.js';
import { renderDeck, renderReview, renderFlip, renderQuiz } from './views/decks.js';
import { CHANGE_EVENT } from './data/db.js';
import { mayUseApp } from './data/auth.js';

// tab: in bottom bar · live: re-render on data change · bare: full screen, no tab bar
const routes = {
  '#/pond':      { label: 'Pond',      render: renderPond,      tab: true, live: true },
  '#/log':       { label: 'Log',       render: renderLog,       tab: true, live: true },
  '#/study':     { label: 'Study',     render: renderStudy,     tab: true, live: true },
  '#/deck':      { label: 'Deck',      render: renderDeck,      live: true },
  '#/review':    { label: 'Review',    render: renderReview,    bare: true },
  '#/flip':      { label: 'Flip',      render: renderFlip,      bare: true },
  '#/quiz':      { label: 'Quiz',      render: renderQuiz,      bare: true },
  '#/course-setup': { label: 'Course setup', render: renderCourseSetup, bare: true },
  '#/settings':  { label: 'Settings',  render: renderSettings,  tab: true },
  '#/favorites': { label: 'Favorites', render: renderFavorites, live: true },
  '#/semesters': { label: 'Semesters', render: renderSemesters, live: true },
  '#/data':      { label: 'Your data', render: renderData },
  '#/friends':   { label: 'Friends',   render: renderFriends },
  '#/welcome':   { label: 'Welcome',   render: renderTutorial,  bare: true },
  '#/setup':     { label: 'New semester', render: renderSetup,  bare: true },
  '#/login':     { label: 'Sign in',   render: renderLogin,     bare: true, open: true },
  '#/signup':    { label: 'Sign up',   render: renderSignup,    bare: true, open: true },
  '#/reset-password': { label: 'New password', render: renderResetPassword, bare: true, open: true },
  '#/merge':     { label: 'Which pond?', render: renderMerge,   bare: true, open: true },
  '#/finish-account': { label: 'Finish account', render: renderFinishAccount, bare: true, open: true },
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
  tabs.innerHTML = '<span class="tabs__brand" aria-hidden="true">Pip’s Pond</span>' + tabRoutes
    .map(([hash, r]) => `<a href="${hash}"${hash === active ? ' aria-current="page"' : ''}>${r.label}</a>`)
    .join('');
}

let queue = Promise.resolve();

export function render() {
  queue = queue
    .then(async () => {
      let hash = current();
      // Gate the app behind sign-in when accounts are on (open routes stay reachable).
      if (!routes[hash].open && !mayUseApp()) hash = '#/login';
      if (location.hash !== hash) history.replaceState(null, '', hash);
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
