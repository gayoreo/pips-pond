// Small pieces of UI shared by the Pond, the practice pond and the report card.
import { formatShort } from '../core/dates.js';
import { frogSVG } from '../pip/frog.js';
import { MOOD_LABEL } from '../pip/mood.js';
import { esc } from './dom.js';

const RING = 2 * Math.PI * 40;

export function noteHTML(kind, label, p, fmt) {
  const isSwipes = kind === 'swipes';
  const over = p.leftToday < -0.004;
  const frac = p.daily > 0 ? Math.min(1, Math.max(0, p.leftToday / p.daily)) : 0;
  const caption = isSwipes
    ? (over ? 'over this week' : 'available today')
    : (over ? 'over today' : 'left today');
  const weekStat = isSwipes
    ? `<span class="stat__v">${fmt(p.usedWeek)}</span><span class="stat__s">used of ${fmt(p.weekly)}</span>`
    : `<span class="stat__v">${fmt(Math.abs(p.leftWeek))}</span><span class="stat__s">${p.leftWeek < -0.004 ? 'over' : 'left'}</span>`;
  const ringValue = fmt(Math.abs(p.leftToday));

  return `
  <section class="note note--${kind}" aria-label="${label}">
    <span class="note__label">${label}</span>
    <div class="ring">
      <svg viewBox="0 0 100 100" width="92" height="92" aria-hidden="true">
        <g filter="url(#wobble)">
          <circle class="ring__track" cx="50" cy="50" r="40" fill="none" stroke-width="9"/>
          ${frac > 0.005 ? `<circle class="ring__fill" cx="50" cy="50" r="40" fill="none" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${(frac * RING).toFixed(1)} ${RING.toFixed(1)}" transform="rotate(-90 50 50)"/>` : ''}
        </g>
      </svg>
      <span class="ring__value${over ? ' is-over' : ''}" data-len="${Math.min(9, esc(ringValue).length)}">${esc(ringValue)}</span>
    </div>
    <span class="note__caption">${caption}</span>
    <div class="note__stats">
      <div class="stat"><span class="stat__k">Week</span>${weekStat}</div>
      <div class="stat"><span class="stat__k">Semester</span><span class="stat__v">${fmt(p.balance)}</span><span class="stat__s">of ${fmt(p.total)}</span></div>
    </div>
  </section>`;
}

export function stampsHTML(ex, resets) {
  const slots = Math.max(ex.limit, ex.used);
  const stamps = Array.from({ length: slots }, (_, i) => {
    if (i >= ex.used) return '<span class="stamp" aria-hidden="true"></span>';
    return `<span class="stamp is-used${i >= ex.limit ? ' is-over' : ''}" aria-hidden="true">USED</span>`;
  }).join('');
  const notes = [];
  if (!ex.allowedToday) notes.push('not available today');
  if (ex.used > ex.limit) notes.push('over the weekly limit');
  if (resets) notes.push(`resets ${formatShort(resets)}`);
  return `
  <section class="stamps" aria-label="Exchanges: ${ex.used} of ${ex.limit} used this week">
    <div>
      <p class="stamps__title">Exchanges this week</p>
      <p class="stamps__sub" id="ex-note">${notes.join(' · ')}</p>
    </div>
    <div class="stamps__row">${stamps}</div>
  </section>`;
}

// The framed pond with lily pads + the frog. `button` makes the frog tappable (to pet it).
export function pondSceneHTML({ mood, name, outfit, button, tag = true, extraClass = '', dancing = false, visitor = null, companion = 'frog' }) {
  const frog = frogSVG(mood, name, { outfit, companion });
  const cls = `frog is-${mood}${dancing ? ' is-dancing' : ''}`;
  const frogEl = button
    ? `<button type="button" class="${cls} frog-btn" data-pet aria-label="Pet ${esc(name)}">${frog}</button>`
    : `<div class="${cls}">${frog}</div>`;
  const visitorEl = visitor
    ? `<div class="frog frog--visitor is-${visitor.mood ?? 'happy'}" aria-label="${esc(visitor.name || 'A friend')} visiting">${frogSVG(visitor.mood ?? 'happy', visitor.name || 'Pip', { companion: visitor.companion || 'frog' })}</div>`
    : '';
  return `
  <div class="pond ${extraClass}${visitor ? ' has-visitor' : ''}">
    <span class="pad pad--a"></span><span class="pad pad--b"></span>
    <span class="ripple ripple--a"></span><span class="ripple ripple--b"></span>
    ${tag ? `<span class="mood-tag">${MOOD_LABEL[mood] ?? mood}</span>` : ''}
    ${frogEl}
    ${visitorEl}
  </div>`;
}
