import { getSettings, getEntries, getArchive, getProfile, switchSemester } from '../data/db.js';
import { reportStats, rolloverFor, nextSemesterDefaults } from '../core/semester.js';
import { formatShort, todayKey } from '../core/dates.js';
import { entriesCSV, download, slug } from '../data/importExport.js';
import { coursesForSemester } from '../data/study.js';
import { courseGrade, gradingOf, gpaOf, fmtPct, fmtGpa, DEFAULT_GPA_SCALE } from '../core/grades.js';

// Final grades for one semester's courses, and a CSV of them.
function gradeRows(key) {
  return coursesForSemester(key).map((course) => ({ course, ...courseGrade(course) }));
}
function gradesCSV(name, rows, scale) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Semester', 'Course', 'Code', 'Credits', 'Pass/fail', 'Percent', 'Letter', 'Grade points'].map(q).join(',')];
  for (const r of rows) {
    const g = gradingOf(r.course);
    lines.push([name, r.course.name, r.course.code || '', g.credits ?? '', g.passFail ? 'yes' : 'no',
      r.pct ?? '', r.letter, g.passFail || !r.letter ? '' : (scale[r.letter] ?? '')].map(q).join(','));
  }
  const { gpa } = gpaOf(rows, scale);
  if (gpa !== null) lines.push(['', 'Semester GPA', '', '', '', '', '', fmtGpa(gpa)].map(q).join(','));
  return lines.join('\n');
}
import { esc, money, plural } from '../ui/dom.js';
import { reportHTML } from '../ui/report.js';
import { beginNewSemester, beginFutureSemester } from './tutorial.js';
import { toast } from '../ui/toast.js';

const openReports = new Set(); // which report cards are expanded

export async function renderSemesters(root) {
  const [settings, entries, archive, profile] = await Promise.all([getSettings(), getEntries(), getArchive(), getProfile()]);
  if (!settings) { location.hash = '#/settings'; return; }
  const today = todayKey();
  const roll = rolloverFor(settings, entries);
  // Newest-first for past semesters, soonest-first for future ones.
  const past = archive.filter((a) => a.settings.end < today).reverse();
  const future = archive.filter((a) => a.settings.end >= today && a.settings.start > today)
    .sort((a, b) => a.settings.start.localeCompare(b.settings.start));

  const item = (id, s, list, { current = false, future: isFuture = false } = {}) => `
    <section class="card semester">
      <div class="semester__head">
        <div>
          <h2 class="card__title">${esc(s.semesterName)}${current ? ' <span class="muted">(now)</span>' : isFuture ? ' <span class="muted">(upcoming)</span>' : ''}</h2>
          <p class="card__hint">${formatShort(s.start)} – ${formatShort(s.end)}${isFuture ? '' : ` · ${plural(list.length, 'entry').replace('entrys', 'entries')}`}</p>
        </div>
      </div>
      <div class="row">
        ${current ? '' : `<button type="button" class="btn-plain" data-switch="${esc(id)}">switch to this</button>`}
        ${isFuture ? '' : `<button type="button" class="btn-plain" data-report="${esc(id)}" aria-expanded="${openReports.has(id)}">${openReports.has(id) ? 'hide' : 'report card'}</button>
        <button type="button" class="btn-plain" data-csv="${esc(id)}">download CSV</button>`}
        ${gradeRows(s.key).length ? `<button type="button" class="btn-plain" data-grades-csv="${esc(id)}">download grades</button>` : ''}
      </div>
      ${gradeRows(s.key).length ? `<p class="card__hint">${gradeRows(s.key).map((r) => `${esc(r.course.name)} ${esc(r.letter || fmtPct(r.pct))}`).join(' · ')}</p>` : ''}
      ${!isFuture && openReports.has(id) ? reportHTML(reportStats(s, list), { frogName: profile.frogName }) : ''}
    </section>`;

  root.innerHTML = `
  <div class="semesters stack">
    <div class="sheet__head">
      <a class="btn-plain btn-plain--muted" href="#/settings">back</a>
      <h1 class="page-title">Semesters</h1>
      <span class="spacer"></span>
    </div>

    ${item('current', settings, entries, { current: true })}

    <section class="card card--sticky">
      <h2 class="card__title">End this semester</h2>
      <p class="card__hint">This semester moves into your history (you can still see and download it).
        ${roll.swipes || roll.points
          ? `Carrying over: ${plural(roll.swipes, 'swipe')} and ${money(roll.points)}.`
          : 'Nothing carries over (rollover is off, or nothing is left).'}
        You’ll confirm the new dates and amounts on the next screens.</p>
      <button type="button" class="btn-sketch btn-sketch--go" data-next-semester>Set up next semester</button>
    </section>

    ${future.length ? '<h2 class="page-title page-title--small">Upcoming semesters</h2>' : ''}
    ${future.map((a) => item(a.id, a.settings, a.entries, { future: true })).join('')}

    <section class="card">
      <h2 class="card__title">Plan ahead</h2>
      <p class="card__hint">Set up a future semester’s dates and budget now, and switch to it whenever it starts. Your current semester keeps going until you switch.</p>
      <button type="button" class="btn-sketch" data-add-future>Set up a future semester</button>
    </section>

    ${past.length ? '<h2 class="page-title page-title--small">Past semesters</h2>' : ''}
    ${past.map((a) => item(a.id, a.settings, a.entries)).join('')}
  </div>`;

  root.querySelector('.semesters').addEventListener('click', async (e) => {
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
    const gcsv = e.target.closest('[data-grades-csv]');
    if (gcsv) {
      const id = gcsv.dataset.gradesCsv;
      const sem = id === 'current' ? { settings } : archive.find((a) => a.id === id);
      if (!sem) return;
      const scale = { ...DEFAULT_GPA_SCALE, ...(profile.gpa?.scale ?? {}) };
      download(`${slug(sem.settings.semesterName)}-grades.csv`, gradesCSV(sem.settings.semesterName, gradeRows(sem.settings.key), scale), 'text/csv');
      return;
    }
    const sw = e.target.closest('[data-switch]');
    if (sw) {
      const id = sw.dataset.switch;
      const target = archive.find((a) => a.id === id);
      if (!target) return;
      if (!confirm(`Switch to ${target.settings.semesterName}? ${settings.semesterName} will be saved and you can switch back any time.`)) return;
      await switchSemester(id);
      toast(`Switched to ${target.settings.semesterName}!`);
      return renderSemesters(root);
    }
    if (e.target.closest('[data-add-future]')) return beginFutureSemester();
    if (e.target.closest('[data-next-semester]')) {
      if (todayKey() <= settings.end &&
          !confirm(`${settings.semesterName} runs until ${formatShort(settings.end)}. Start the next semester anyway? This one will move into your history.`)) return;
      beginNewSemester(nextSemesterDefaults(settings, entries));
    }
  });
}