// Semester report card.
import { esc, money, plural } from './dom.js';
import { formatShort } from '../core/dates.js';

export function reportHTML(r, { frogName = 'Pip' } = {}) {
  const pct = Math.round(r.onPace * 100);
  const unusedSw = Math.max(0, r.leftover.swipes);
  const unusedPt = Math.max(0, r.leftover.points);
  return `
  <section class="report" aria-label="Report card for ${esc(r.name)}">
    <div class="report__head">
      <div>
        <p class="eyebrow">Report card · ${formatShort(r.start)} – ${formatShort(r.end)}</p>
        <h2 class="report__name">${esc(r.name)}</h2>
      </div>
      <div class="report__grade" aria-label="Grade ${esc(r.grade)}">${esc(r.grade)}</div>
    </div>
    <p class="report__title hand">“${esc(r.title)}”, says ${esc(frogName)}.</p>
    <dl class="report__grid">
      <div><dt>Swipes used</dt><dd>${r.swipesUsed} <small>of ${r.totals.swipes}</small></dd></div>
      <div><dt>Points spent</dt><dd>${money(r.pointsSpent)} <small>of ${money(r.totals.points)}</small></dd></div>
      <div><dt>On-pace days</dt><dd>${pct}% <small>${r.moods.happy + r.moods.worried} of ${r.moods.happy + r.moods.worried + r.moods.sad}</small></dd></div>
      <div><dt>Exchanges</dt><dd>${r.exchanges}</dd></div>
      <div><dt>Days logged</dt><dd>${r.daysLogged}</dd></div>
      <div><dt>Left over</dt><dd>${plural(unusedSw, 'swipe')} · ${money(unusedPt)}</dd></div>
      ${r.guests ? `<div><dt>Guest passes</dt><dd>${r.guests}</dd></div>` : ''}
      ${r.bigWeek ? `<div><dt>Biggest week</dt><dd>${money(r.bigWeek.amount)} <small>wk of ${formatShort(r.bigWeek.week)}</small></dd></div>` : ''}
    </dl>
  </section>`;
}
