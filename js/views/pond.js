import { getSettings, getEntries, getFavorites } from '../data/db.js';
import { budget } from '../core/calc.js';
import { todayKey, formatLong, formatShort } from '../core/dates.js';
import { moodFor, isEating, MOOD_LABEL } from '../pip/mood.js';
import { pipLine } from '../pip/lines.js';
import { frogSVG } from '../pip/frog.js';
import { esc, money, count } from '../ui/dom.js';
import { openFeedSheet, quickLog, describe } from './feed.js';

const RING = 2 * Math.PI * 40;

function noteHTML(kind, label, p, fmt) {
  const over = p.leftToday < -0.004;
  const frac = p.daily > 0 ? Math.min(1, Math.max(0, p.leftToday / p.daily)) : 0;
  const weekOver = p.leftWeek < -0.004;
  return `
  <section class="note note--${kind}" aria-label="${label}">
    <span class="note__label">${label}</span>
    <div class="ring">
      <svg viewBox="0 0 100 100" width="92" height="92" aria-hidden="true">
        <g filter="url(#wobble)">
          <circle class="ring__track" cx="50" cy="50" r="40" fill="none" stroke-width="9"/>
          <circle class="ring__fill" cx="50" cy="50" r="40" fill="none" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${(frac * RING).toFixed(1)} ${RING.toFixed(1)}" transform="rotate(-90 50 50)"/>
        </g>
      </svg>
      <span class="ring__value${over ? ' is-over' : ''}">${fmt(Math.abs(p.leftToday))}</span>
    </div>
    <span class="note__caption">${over ? 'over today' : 'left today'}</span>
    <div class="note__stats">
      <div class="stat"><span class="stat__k">Week</span><span class="stat__v">${fmt(Math.abs(p.leftWeek))}</span><span class="stat__s">${weekOver ? 'over' : 'left'}</span></div>
      <div class="stat"><span class="stat__k">Semester</span><span class="stat__v">${fmt(p.balance)}</span><span class="stat__s">of ${fmt(p.total)}</span></div>
    </div>
  </section>`;
}

function stampsHTML(ex, resets) {
  const slots = Math.max(ex.limit, ex.used);
  const stamps = Array.from({ length: slots }, (_, i) => {
    if (i >= ex.used) return '<span class="stamp" aria-hidden="true"></span>';
    return `<span class="stamp is-used${i >= ex.limit ? ' is-over' : ''}" aria-hidden="true">USED</span>`;
  }).join('');
  const notes = [];
  if (!ex.allowedToday) notes.push('not available today');
  if (ex.used > ex.limit) notes.push('over the weekly limit');
  notes.push(`resets ${formatShort(resets)}`);
  return `
  <section class="stamps" aria-label="Exchanges: ${ex.used} of ${ex.limit} used this week">
    <div>
      <p class="stamps__title">Exchanges this week</p>
      <p class="stamps__sub" id="ex-note">${notes.join(' · ')}</p>
    </div>
    <div class="stamps__row">${stamps}</div>
  </section>`;
}

function favRowHTML(favorites) {
  if (!favorites.length) {
    return '<div class="fav-row"><a class="fav-row__edit fav-row__edit--start" href="#/favorites">+ save a favorite order</a></div>';
  }
  return `
  <div class="fav-row">
    <span class="fav-row__label">favs:</span>
    ${favorites.slice(0, 4).map((f) => `<button type="button" class="fav fav--${f.type}" data-fav="${esc(f.id)}">${esc(f.name)} ${esc(describe(f.type, f.amount))}</button>`).join('')}
    <a class="fav-row__edit" href="#/favorites">edit</a>
  </div>`;
}

function phaseHTML(b, settings) {
  if (b.phase === 'before') return `<section class="card"><p class="hand">Semester starts ${formatShort(settings.start)}. Pip is napping until then.</p></section>`;
  if (b.phase === 'after') return '<section class="card"><p class="hand">The semester’s over! Pip is resting.</p></section>';
  return '';
}

export async function renderPond(root) {
  const settings = await getSettings();
  if (!settings) { location.hash = '#/settings'; return; }

  const entries = await getEntries();
  const favorites = await getFavorites();
  const today = todayKey();
  const b = budget(settings, entries, today);
  const mood = isEating() ? 'eating' : moodFor(b);
  const line = pipLine(mood, b, entries.length + Number(today.slice(-2)));

  root.innerHTML = `
    <header>
      <p class="eyebrow">${esc(settings.semesterName)} · ${b.daysLeft} eating ${b.daysLeft === 1 ? 'day' : 'days'} left</p>
      <h1 class="page-title">${formatLong(today)}</h1>
    </header>

    <section aria-label="Pip">
      <div class="pond">
        <span class="pad pad--a"></span><span class="pad pad--b"></span>
        <span class="ripple ripple--a"></span><span class="ripple ripple--b"></span>
        <span class="mood-tag">${MOOD_LABEL[mood]}</span>
        <div class="frog is-${mood}">${frogSVG(mood)}</div>
      </div>
      <p class="pip-says">“${esc(line)}”</p>
    </section>

    ${phaseHTML(b, settings)}

    <div class="notes">
      ${noteHTML('swipes', 'Swipes', b.swipes, count)}
      ${noteHTML('points', 'Points', b.points, money)}
    </div>

    ${stampsHTML(b.exchanges, b.weekResets)}

    <section aria-label="Feed Pip" data-feed-area>
      <p class="feed__title">Feed Pip:</p>
      <div class="feed-row">
        <button type="button" class="btn-sketch btn-sketch--swipe" data-feed="swipe">a swipe</button>
        <button type="button" class="btn-sketch btn-sketch--points" data-feed="points">points</button>
        <button type="button" class="btn-sketch btn-sketch--exchange" data-feed="exchange"${b.exchanges.allowedToday ? '' : ' disabled aria-describedby="ex-note"'}>exchange</button>
      </div>
      ${favRowHTML(favorites)}
    </section>`;

  root.querySelector('[data-feed-area]').addEventListener('click', (e) => {
    const feed = e.target.closest('[data-feed]');
    if (feed) {
      if (feed.dataset.feed === 'points') return openFeedSheet({ type: 'points' });
      return quickLog({ type: feed.dataset.feed, amount: 1 });
    }
    const chip = e.target.closest('[data-fav]');
    if (chip) {
      const f = favorites.find((x) => x.id === chip.dataset.fav);
      if (f) quickLog({ type: f.type, amount: f.amount, label: `${f.name} (${describe(f.type, f.amount)})` });
    }
  });
}