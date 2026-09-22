import { getSettings, getEntries, getArchive, getProfile } from '../data/db.js';
import { reportStats, rolloverFor, nextSemesterDefaults } from '../core/semester.js';
import { formatShort, todayKey } from '../core/dates.js';
import { entriesCSV, download, slug } from '../data/importExport.js';
import { esc, money, plural } from '../ui/dom.js';
import { reportHTML } from '../ui/report.js';
import { beginNewSemester } from './tutorial.js';

const openReports = new Set(); // which report cards are expanded

export async function renderSemesters(root) {
  const [settings, entries, archive, profile] = await Promise.all([getSettings(), getEntries(), getArchive(), getProfile()]);
  if (!settings) { location.hash = '#/settings'; return; }
  const roll = rolloverFor(settings, entries);
  const past = [...archive].reverse();

  const item = (id, s, list, current) => `
    <section class="card semester">
      <div class="semester__head">
        <div>
          <h2 class="card__title">${esc(s.semesterName)}${current ? ' <span class="muted">(now)</span>' : ''}</h2>
          <p class="card__hint">${formatShort(s.start)} – ${formatShort(s.end)} · ${plural(list.length, 'entry').replace('entrys', 'entries')}</p>
        </div>
      </div>
      <div class="row">
        <button type="button" class="btn-plain" data-report="${esc(id)}" aria-expanded="${openReports.has(id)}">${openReports.has(id) ? 'hide' : 'report card'}</button>
        <button type="button" class="btn-plain" data-csv="${esc(id)}">download CSV</button>
      </div>
      ${openReports.has(id) ? reportHTML(reportStats(s, list), { frogName: profile.frogName }) : ''}
    </section>`;

  root.innerHTML = `
  <div class="semesters stack">
    <div class="sheet__head">
      <a class="btn-plain btn-plain--muted" href="#/settings">back</a>
      <h1 class="page-title">Semesters</h1>
      <span class="spacer"></span>
    </div>

    ${item('current', settings, entries, true)}

    <section class="card card--sticky">
      <h2 class="card__title">Start next semester</h2>
      <p class="card__hint">This semester moves into your history (you can still see and download it).
        ${roll.swipes || roll.points
          ? `Carrying over: ${plural(roll.swipes, 'swipe')} and ${money(roll.points)}.`
          : 'Nothing carries over (rollover is off, or nothing is left).'}
        You’ll confirm the new dates and amounts on the next screens.</p>
      <button type="button" class="btn-sketch btn-sketch--go" data-next-semester>Set up next semester</button>
    </section>

    ${past.length ? '<h2 class="page-title page-title--small">Past semesters</h2>' : ''}
    ${past.map((a) => item(a.id, a.settings, a.entries, false)).join('')}
  </div>`;

  root.querySelector('.semesters').addEventListener('click', (e) => {
    const rep = e.target.closest('[data-report]');
    if (rep) {
      const id = rep.dataset.report;
      if (openReports.has(id)) openReports.delete(id); else openReports.add(id);
      return renderSemesters(root);
    }
    const csv = e.target.closest('[data-csv]');
    if (csv) {
      const id = csv.dataset.csv;
      const sem = id === 'current' ? { settings, entries } : archive.find((a) => a.id === id);
      if (!sem) return;
      download(`${slug(sem.settings.semesterName)}.csv`, entriesCSV([{ name: sem.settings.semesterName, entries: sem.entries }]), 'text/csv');
      return;
    }
    if (e.target.closest('[data-next-semester]')) {
      if (todayKey() <= settings.end &&
          !confirm(`${settings.semesterName} runs until ${formatShort(settings.end)}. Start the next semester anyway? This one will move into your history.`)) return;
      beginNewSemester(nextSemesterDefaults(settings, entries));
    }
  });
}
