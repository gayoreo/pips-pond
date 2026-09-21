import { getSettings, getEntries, addEntry } from '../data/db.js';
import { budget } from '../core/calc.js';
import { todayKey, formatLong, formatShort } from '../core/dates.js';
import { moodFor, isEating, startEating, MOOD_LABEL } from '../pip/mood.js';
import { pipLine } from '../pip/lines.js';
import { frogSVG } from '../pip/frog.js';
import { esc, money, count } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openFeedSheet } from './feed.js';

const RING = 2 * Math.PI * 40; // circumference of the r=40 ring

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
    const extra = i >= ex.limit;
    return `<span class="stamp is-used${extra ? ' is-over' : ''}" aria-hidden="true">USED</span>`;
  }).join('');
  return `
  <section class="stamps" aria-label="Exchanges: ${ex.used} of ${ex.limit} used this week">
    <div>
      <p class="stamps__title">Exchanges this week</p>
      <p class="stamps__sub">${ex.used > ex.limit ? 'over the weekly limit · ' : ''}resets ${formatShort(resets)}</p>
    </div>
    <div class="stamps__row">${stamps}</div>
  </section>`;
}

function phaseHTML(b, settings) {
  if (b.phase === 'before') return `<section class="card"><p class="hand">Semester starts ${formatShort(settings.start)}. Pip is napping until then.</p></section>`;
  if (b.phase === 'after') return `<section class="card"><p class="hand">The semester's over! Pip is resting. You can set up a new semester in Settings.</p></section>`;
  return '';
}

export async function renderPond(root) {
  const settings = await getSettings();
  if (!settings) { location.hash = '#/settings'; return; }

  const entries = await getEntries();
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

    <section aria-label="Feed Pip">
      <p class="feed__title">Feed Pip:</p>
      <div class="feed-row">
        <button type="button" class="btn-sketch btn-sketch--swipe" data-feed="swipe">a swipe</button>
        <button type="button" class="btn-sketch btn-sketch--points" data-feed="points">points</button>
        <button type="button" class="btn-sketch btn-sketch--exchange" data-feed="exchange">exchange</button>
      </div>
    </section>`;

  root.querySelector('.feed-row').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-feed]');
    if (!btn) return;
    const kind = btn.dataset.feed;

    if (kind === 'points') return openFeedSheet({ type: 'points' });

    if (kind === 'exchange' && b.exchanges.used >= b.exchanges.limit &&
        !confirm(`That's past your ${b.exchanges.limit} exchanges this week. Log it anyway?`)) return;

    startEating();
    await addEntry({ type: kind, amount: 1 });
    toast(kind === 'swipe' ? 'Pip ate a swipe!' : 'Pip ate an exchange!');
  });
}