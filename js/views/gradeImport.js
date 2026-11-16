// Paste a CSV of completed grades into the current course, with a preview and duplicate protection.
import { getStudy, saveGradeItem } from '../data/study.js';
import { gradingOf } from '../core/grades.js';
import { openSheet } from '../ui/sheet.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
function parseCsv(input) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error('Unclosed quotation mark in CSV.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function previewGradeCsv(course, input) {
  const rows = parseCsv(input);
  if (rows.length < 2) throw new Error('Paste a CSV header and at least one assignment.');
  const header = rows.shift().map(norm);
  const col = (name) => header.indexOf(norm(name));
  for (const name of ['Assignment', 'Possible', 'Category'])
    if (col(name) < 0) throw new Error('Missing CSV column: ' + name);
  const cats = gradingOf(course).categories.filter(c => !c.bonus);
  const existing = new Set((course.grades ?? []).map(it => norm(it.name)));
  const seen = new Set();
  return rows.map((r, index) => {
    const name = (r[col('Assignment')] ?? '').trim();
    const category = (r[col('Category')] ?? '').trim();
    const earnedRaw = col('Earned') >= 0 ? (r[col('Earned')] ?? '').trim() : '';
    const statusRaw = col('Status') >= 0 ? (r[col('Status')] ?? '').trim() : '';
    const statusKey = norm(statusRaw);
    const status = !statusKey ? (earnedRaw === '' ? 'pending' : 'graded')
      : statusKey === 'graded' ? 'graded'
      : ['pending', 'notgraded', 'notgradedyet', 'ungraded'].includes(statusKey) ? 'pending' : '';
    const earned = earnedRaw === '' ? null : Number(earnedRaw);
    const possibleRaw = (r[col('Possible')] ?? '').trim();
    const possible = possibleRaw === '' ? null : Number(possibleRaw);
    const courseValue = col('Course') >= 0 ? (r[col('Course')] ?? '').trim() : '';
    const match = cats.find(c => norm(c.name) === norm(category));
    let reason = '';
    if (courseValue && norm(courseValue) !== norm(course.code) && norm(courseValue) !== norm(course.name)) reason = 'Other course';
    else if (!name) reason = 'Missing assignment name';
    else if (name.length > 60) reason = 'Name exceeds 60 characters';
    else if (!Number.isFinite(possible) || possible <= 0) reason = 'Invalid points possible';
    else if (!status) reason = 'Unknown status (use Graded or Not graded yet)';
    else if (status === 'graded' && (earnedRaw === '' || !Number.isFinite(earned) || earned < 0)) reason = 'Invalid earned score';
    else if (status === 'pending' && earnedRaw !== '') reason = 'Leave Earned blank for Not graded yet';
    else if (!match) reason = 'Category not found';
    else if (existing.has(norm(name)) || seen.has(norm(name))) reason = 'Already exists';
    seen.add(norm(name));
    return { line: index + 2, name, earned: status === 'graded' ? earned : '', possible, status, catId: match?.id, category, reason };
  });
}
export function openGradeImport(course) {
  const html = `
    <p class="card__hint">Paste CSV with Category, Assignment, Possible, and optional Course, Earned, Status. Leave Earned blank to add an assignment as “Not graded yet”; a score of 0 is a graded zero. Status can also be Graded or Not graded yet. Categories must match this course’s grade setup. Existing assignments are never changed.</p>
    <textarea class="study-notes" data-grade-csv rows="9" placeholder="Course,Category,Assignment,Earned,Possible,Status&#10;GERM 1100,Daily homework,Homework 2,10,10,Graded&#10;GERM 1100,Daily homework,Homework 3,,10,Not graded yet"></textarea>
    <button type="button" class="btn-sketch btn-sketch--go" data-preview-grades>Preview import</button>
    <div data-import-result aria-live="polite"></div>`;
  openSheet('Import grades from CSV', html, (sheet, close) => {
    const result = sheet.querySelector('[data-import-result]');
    let ready = [];
    sheet.addEventListener('input', e => { if (e.target.matches('[data-grade-csv]')) { ready = []; result.innerHTML = ''; } });
    sheet.addEventListener('click', e => {
      if (e.target.closest('[data-preview-grades]')) {
        try {
          const current = getStudy().courses.find(c => c.id === course.id);
          if (!current) throw new Error('Course not found.');
          const entries = previewGradeCsv(current, sheet.querySelector('[data-grade-csv]').value);
          ready = entries.filter(x => !x.reason);
          const skipped = entries.filter(x => x.reason);
          const graded = ready.filter(x => x.status === 'graded').length;
          const pending = ready.filter(x => x.status === 'pending').length;
          result.innerHTML = `<p><strong>${ready.length} new assignments</strong> (${graded} graded, ${pending} not graded yet) · ${skipped.length} skipped</p>
            <ul class="grade-items">${entries.map(x => `<li>${esc(x.name || '(unnamed)')} · ${esc(x.reason || ((x.status === 'pending' ? 'Not graded yet · --' : x.earned) + '/' + x.possible + ' · ' + x.category))}${x.reason ? ' (skipped)' : ''}</li>`).join('')}</ul>
            ${ready.length ? '<button type="button" class="btn-sketch btn-sketch--go" data-confirm-grades>Import ' + ready.length + ' assignments</button>' : ''}`;
        } catch (error) { ready = []; result.textContent = error.message; }
      }
      if (e.target.closest('[data-confirm-grades]') && ready.length) {
        const current = getStudy().courses.find(c => c.id === course.id);
        if (!current) { toast('Course no longer exists.'); return; }
        // Recheck against current data before writing, even if another tab added assignments.
        const latest = previewGradeCsv(current, sheet.querySelector('[data-grade-csv]').value).filter(x => !x.reason);
        latest.forEach(x => saveGradeItem(course.id, { name: x.name, catId: x.catId, earned: x.earned, possible: x.possible, status: x.status, extra: '', isFinal: false }));
        close();
        toast(latest.length ? 'Imported ' + latest.length + ' assignments. Existing scores untouched.' : 'No new assignments to import.');
      }
    });
  });
}
