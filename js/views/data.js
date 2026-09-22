import { getSettings, getEntries, getArchive, addEntries, exportAll, importAll } from '../data/db.js';
import { parseCSV, mapSchoolRows, download, entriesCSV } from '../data/importExport.js';
import { todayKey, formatShort } from '../core/dates.js';
import { esc, money } from '../ui/dom.js';
import { infoBtn } from '../ui/info.js';
import { toast } from '../ui/toast.js';
import { describe } from './feed.js';

// School-import state (kept while the page is open)
const imp = { rows: null, header: true, dateCol: 0, amountCol: 1, descCol: -1, mode: 'points', skipDeposits: true, onlyThis: true, skipDup: true };

function guessColumns(headers) {
  const find = (re) => headers.findIndex((h) => re.test(h));
  const date = find(/date|time|posted/i);
  const amount = find(/amount|debit|total|charge|price|\$/i);
  const desc = find(/desc|location|merchant|place|vendor|memo|detail|name/i);
  if (date >= 0) imp.dateCol = date;
  if (amount >= 0) imp.amountCol = amount;
  imp.descCol = desc;
}

function importUI(settings, existing) {
  if (!imp.rows) return '';
  const headers = imp.header ? imp.rows[0] : imp.rows[0].map((_, i) => `Column ${i + 1}`);
  const body = imp.header ? imp.rows.slice(1) : imp.rows;
  const opt = (sel, allowNone) => `${allowNone ? `<option value="-1"${sel === -1 ? ' selected' : ''}>(none)</option>` : ''}
    ${headers.map((h, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}`;
  const result = mapSchoolRows(body, {
    dateCol: imp.dateCol, amountCol: imp.amountCol, descCol: imp.descCol, mode: imp.mode,
    skipDeposits: imp.skipDeposits, skipDuplicates: imp.skipDup,
    onlyBetween: imp.onlyThis ? [settings.start, settings.end] : null, existing,
  });
  const sk = result.skipped;
  const skippedText = [
    sk.badDate && `${sk.badDate} without a readable date`,
    sk.badAmount && `${sk.badAmount} without an amount`,
    sk.deposit && `${sk.deposit} deposits`,
    sk.outside && `${sk.outside} outside this semester`,
    sk.duplicate && `${sk.duplicate} already logged`,
  ].filter(Boolean).join(', ');
  imp.ready = result.entries;

  return `
  <div class="stack import-map">
    <label class="row"><span>First row is column names</span><input type="checkbox" class="switch" data-imp="header"${imp.header ? ' checked' : ''}></label>
    <div class="grid-2">
      <label class="field">Date column<select data-imp="dateCol">${opt(imp.dateCol)}</select></label>
      <label class="field">Amount column<select data-imp="amountCol">${opt(imp.amountCol)}</select></label>
    </div>
    <label class="field">Description column<select data-imp="descCol">${opt(imp.descCol, true)}</select></label>
    <label class="field">These rows are
      <select data-imp="mode">
        <option value="points"${imp.mode === 'points' ? ' selected' : ''}>Points purchases</option>
        <option value="swipe"${imp.mode === 'swipe' ? ' selected' : ''}>Meal swipes (1 per row)</option>
        <option value="guess"${imp.mode === 'guess' ? ' selected' : ''}>Guess from the description</option>
      </select>
    </label>
    <label class="row"><span>Skip deposits &amp; refunds</span><input type="checkbox" class="switch" data-imp="skipDeposits"${imp.skipDeposits ? ' checked' : ''}></label>
    <label class="row"><span>Only this semester’s dates</span><input type="checkbox" class="switch" data-imp="onlyThis"${imp.onlyThis ? ' checked' : ''}></label>
    <label class="row"><span>Skip ones I already logged</span><input type="checkbox" class="switch" data-imp="skipDup"${imp.skipDup ? ' checked' : ''}></label>

    <p class="hand">Ready to import ${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'}.</p>
    ${skippedText ? `<p class="card__hint">Skipping ${skippedText}.</p>` : ''}
    ${result.entries.length ? `
    <table class="preview">
      <thead><tr><th>Date</th><th>What</th><th>Note</th></tr></thead>
      <tbody>${result.entries.slice(0, 8).map((e) => `<tr><td>${formatShort(e.date)}</td><td>${esc(describe(e.type, e.amount))}</td><td>${esc(e.note.replace(/^imported:?\s*/, ''))}</td></tr>`).join('')}</tbody>
    </table>
    ${result.entries.length > 8 ? `<p class="card__hint">…and ${result.entries.length - 8} more.</p>` : ''}
    <button type="button" class="btn-sketch btn-sketch--go" data-import-go>Import ${result.entries.length}</button>` : ''}
    <button type="button" class="btn-plain btn-plain--muted" data-import-cancel>start over</button>
  </div>`;
}

export async function renderData(root) {
  const [settings, entries, archive] = await Promise.all([getSettings(), getEntries(), getArchive()]);
  if (!settings) { location.hash = '#/settings'; return; }
  const total = entries.reduce((n, e) => n + (e.type === 'points' ? e.amount : 0), 0);

  root.innerHTML = `
  <div class="data-page stack">
    <div class="sheet__head">
      <a class="btn-plain btn-plain--muted" href="#/settings">back</a>
      <h1 class="page-title">Your data</h1>
      <span class="spacer"></span>
    </div>

    <section class="card">
      <h2 class="card__title">Download ${infoBtn('The full backup has everything: settings, entries, favorites, past semesters and your frog’s name. Restore it below on any device.')}</h2>
      <p class="card__hint">${entries.length} entries this semester (${money(total)} in points)${archive.length ? `, plus ${archive.length} past ${archive.length === 1 ? 'semester' : 'semesters'}` : ''}.</p>
      <button type="button" class="btn-sketch" data-export="csv">Spreadsheet (CSV), all semesters</button>
      <button type="button" class="btn-sketch" data-export="json">Full backup (JSON)</button>
    </section>

    <section class="card">
      <h2 class="card__title">Import from your school ${infoBtn('Most dining portals (like GET, Transact or CBORD) can export your transaction history as a CSV. Upload it here and match up the columns.')}</h2>
      ${imp.rows ? importUI(settings, entries) : `
      <p class="card__hint">Upload a CSV from your dining portal, or paste the rows.</p>
      <label class="field">CSV file<input type="file" id="imp-file" accept=".csv,text/csv,text/plain"></label>
      <label class="field">…or paste<textarea id="imp-text" rows="4" class="textarea"></textarea></label>
      <button type="button" class="btn-sketch" data-import-read>Read it</button>`}
    </section>

    <section class="card">
      <h2 class="card__title card__title--danger">Restore a backup</h2>
      <p class="card__hint">Replaces everything on this device with the backup file.</p>
      <label class="field">Backup file<input type="file" id="restore-file" accept=".json,application/json"></label>
    </section>
  </div>`;

  const page = root.querySelector('.data-page');

  page.addEventListener('click', async (e) => {
    const ex = e.target.closest('[data-export]');
    if (ex) {
      if (ex.dataset.export === 'csv') {
        const sems = [...archive.map((a) => ({ name: a.settings.semesterName, entries: a.entries })), { name: settings.semesterName, entries }];
        download(`pips-pond-${todayKey()}.csv`, entriesCSV(sems), 'text/csv');
      } else {
        download(`pips-pond-backup-${todayKey()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json');
      }
      return toast('Downloaded!');
    }
    if (e.target.closest('[data-import-read]')) {
      const file = root.querySelector('#imp-file').files[0];
      const text = file ? await file.text() : root.querySelector('#imp-text').value;
      const rows = parseCSV(text);
      if (rows.length < 1) return toast('That doesn’t look like a CSV.');
      imp.rows = rows;
      imp.header = true;
      guessColumns(rows[0]);
      return renderData(root);
    }
    if (e.target.closest('[data-import-cancel]')) { imp.rows = null; return renderData(root); }
    if (e.target.closest('[data-import-go]')) {
      const n = await addEntries(imp.ready ?? []);
      imp.rows = null;
      toast(`Imported ${n} ${n === 1 ? 'entry' : 'entries'}!`);
      return renderData(root);
    }
  });

  page.addEventListener('change', async (e) => {
    const key = e.target.dataset.imp;
    if (key) {
      imp[key] = e.target.type === 'checkbox' ? e.target.checked
        : ['dateCol', 'amountCol', 'descCol'].includes(key) ? Number(e.target.value) : e.target.value;
      return renderData(root);
    }
    if (e.target.id === 'restore-file' && e.target.files[0]) {
      if (!confirm('Replace everything on this device with this backup?')) { e.target.value = ''; return; }
      try {
        await importAll(JSON.parse(await e.target.files[0].text()));
        toast('Backup restored!');
        location.hash = '#/pond';
      } catch (err) {
        toast(err.message || 'That file couldn’t be read.');
      }
    }
  });
}

