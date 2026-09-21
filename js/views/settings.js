import { getSettings, saveSettings, getEntries, addEntry, resetAll, getTheme, setTheme, getProfile, saveProfile } from '../data/db.js';
import { budget, exchangeDaysOf, DEFAULT_EXCHANGE_DAYS } from '../core/calc.js';
import { todayKey, addDays, formatShort } from '../core/dates.js';
import { esc, count, applyTheme } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const THEMES = [['paper', 'Paper'], ['night', 'Night'], ['auto', 'Match phone']];
let draftDaysOff = [];

function seasonName(key) {
  const m = Number(key.slice(5, 7));
  const season = m <= 5 ? 'Spring' : m <= 7 ? 'Summer' : 'Fall';
  return `${season} ${key.slice(0, 4)}`;
}

function defaults() {
  const start = todayKey();
  return {
    semesterName: seasonName(start), start, end: addDays(start, 104), weekStart: 0,
    swipesTotal: '', pointsTotal: '', swipesRollover: false, pointsRollover: false,
    exchangeLimit: 2, exchangeUsesSwipe: false, exchangeDays: DEFAULT_EXCHANGE_DAYS,
    daysOff: [], keypad: 'regular', logView: 'calendar',
  };
}

const rangeText = (d) => (d.from === d.to ? formatShort(d.from) : `${formatShort(d.from)} – ${formatShort(d.to)}`);

function renderDaysOff(root) {
  root.querySelector('#days-off-list').innerHTML = draftDaysOff.length
    ? draftDaysOff.map((d, i) => `
        <span class="tape">${esc(d.label)} · ${rangeText(d)}
          <button type="button" data-remove="${i}" aria-label="Remove ${esc(d.label)}">✕</button>
        </span>`).join('')
    : '<p class="card__hint">No days off yet.</p>';
}

function readForm(form) {
  const f = new FormData(form);
  const num = (k) => (String(f.get(k)).trim() === '' ? NaN : Number(f.get(k)));
  const start = String(f.get('start'));
  return {
    semesterName: String(f.get('semesterName')).trim() || seasonName(start || todayKey()),
    start,
    end: String(f.get('end')),
    weekStart: Number(f.get('weekStart')),
    swipesTotal: num('swipesTotal'),
    pointsTotal: num('pointsTotal'),
    swipesRollover: f.has('swipesRollover'),
    pointsRollover: f.has('pointsRollover'),
    exchangeLimit: num('exchangeLimit'),
    exchangeUsesSwipe: f.has('exchangeUsesSwipe'),
    exchangeDays: f.getAll('exchangeDays').map(Number),
    keypad: String(f.get('keypad')),
    logView: String(f.get('logView')),
    daysOff: draftDaysOff,
  };
}

function problemWith(s) {
  const whole = (n) => Number.isInteger(n) && n >= 0;
  if (!s.start || !s.end) return 'Pick the semester start and end dates.';
  if (s.end < s.start) return 'The end date is before the start date.';
  if (!whole(s.swipesTotal)) return 'Swipes must be a whole number (0 is fine).';
  if (!(Number.isFinite(s.pointsTotal) && s.pointsTotal >= 0)) return 'Enter your points (0 is fine).';
  if (!whole(s.exchangeLimit)) return 'The exchange limit must be a whole number (0 is fine).';
  return null;
}

export async function renderSettings(root) {
  const saved = await getSettings();
  const s = { ...defaults(), ...(saved ?? {}) };
  draftDaysOff = (s.daysOff ?? []).map((d) => ({ ...d }));
  const exDays = exchangeDaysOf(s);
  const b = saved ? budget(saved, await getEntries(), todayKey()) : null;
  const theme = getTheme();
  const profile = await getProfile();

  root.innerHTML = `
    <header>
      ${saved ? '' : '<p class="eyebrow">Welcome to the Pond</p>'}
      <h1 class="page-title">${saved ? 'Settings' : 'Let’s set up your pond'}</h1>
    </header>
    <section class="card">
      <h2 class="card__title">You &amp; your frog</h2>
      <div class="grid-2">
        <label class="field">Your nickname<input id="p-nick" maxlength="24" autocomplete="nickname" value="${esc(profile.nickname)}"></label>
        <label class="field">Frog’s name<input id="p-frog" maxlength="24" autocomplete="off" value="${esc(profile.frogName)}"></label>
      </div>
      <div class="row">
        <button type="button" class="btn-sketch" id="p-save">Save names</button>
        <a class="btn-plain" href="#/welcome">Replay tutorial</a>
      </div>
    </section>
    <form id="settings-form" class="stack" novalidate>
      <section class="card">
        <h2 class="card__title">Semester</h2>
        <label class="field">Name<input name="semesterName" value="${esc(s.semesterName)}" autocomplete="off" maxlength="40"></label>
        <div class="grid-2">
          <label class="field">Starts<input type="date" name="start" value="${esc(s.start)}" required></label>
          <label class="field">Ends<input type="date" name="end" value="${esc(s.end)}" required></label>
        </div>
        <label class="field">Week starts on
          <select name="weekStart">
            ${DAYS.map((d, i) => `<option value="${i}"${Number(s.weekStart) === i ? ' selected' : ''}>${d}</option>`).join('')}
          </select>
        </label>
      </section>

      <section class="card">
        <h2 class="card__title">Meal plan</h2>
        <div class="grid-2">
          <label class="field">Swipes / semester<input type="number" name="swipesTotal" inputmode="numeric" min="0" step="1" value="${esc(s.swipesTotal)}"></label>
          <label class="field">Points / semester ($)<input type="number" name="pointsTotal" inputmode="decimal" min="0" step="0.01" value="${esc(s.pointsTotal)}"></label>
        </div>
        <label class="row"><span>Leftover swipes carry over</span><input type="checkbox" class="switch" name="swipesRollover"${s.swipesRollover ? ' checked' : ''}></label>
        <label class="row"><span>Leftover points carry over</span><input type="checkbox" class="switch" name="pointsRollover"${s.pointsRollover ? ' checked' : ''}></label>
        <p class="card__hint">Rollover is applied when you start next semester.</p>
      </section>

      <section class="card">
        <h2 class="card__title card__title--plum">Exchanges</h2>
        <label class="field">Max per week<input type="number" name="exchangeLimit" inputmode="numeric" min="0" step="1" value="${esc(s.exchangeLimit)}"></label>
        <fieldset class="days-pick">
          <legend class="field">Allowed on</legend>
          ${DAYS.map((d, i) => `
            <label class="daychip"><input type="checkbox" name="exchangeDays" value="${i}"${exDays.includes(i) ? ' checked' : ''}><span>${d.slice(0, 3)}</span></label>`).join('')}
        </fieldset>
        <label class="row"><span>An exchange also uses a swipe</span><input type="checkbox" class="switch" name="exchangeUsesSwipe"${s.exchangeUsesSwipe ? ' checked' : ''}></label>
        <p class="card__hint">Resets each week. Unused exchanges don’t carry over.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Days off (naptime)</h2>
        <div class="chip-row" id="days-off-list"></div>
        <div class="grid-2">
          <label class="field">First day<input type="date" id="off-from"></label>
          <label class="field">Last day<input type="date" id="off-to"></label>
        </div>
        <label class="field">Label<input id="off-label" maxlength="40" autocomplete="off"></label>
        <button type="button" class="btn-sketch" id="off-add">+ add days off</button>
        <p class="card__hint">Days off are left out of your daily budget. Remember to save.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Logging</h2>
        <label class="field">Keypad
          <select name="keypad">
            <option value="regular"${s.keypad !== 'cents' ? ' selected' : ''}>Type the dot (4 . 7 5)</option>
            <option value="cents"${s.keypad === 'cents' ? ' selected' : ''}>Cents (4 7 5 → $4.75)</option>
          </select>
        </label>
        <label class="field">Log tab layout
          <select name="logView">
            <option value="calendar"${s.logView !== 'journal' ? ' selected' : ''}>Calendar + day page</option>
            <option value="journal"${s.logView === 'journal' ? ' selected' : ''}>Journal pages</option>
          </select>
        </label>
        ${saved ? '<a class="btn-plain" href="#/favorites">Edit favorites →</a>' : ''}
      </section>

      <button type="submit" class="btn-sketch btn-sketch--go btn-sketch--big">${saved ? 'Save changes' : 'Start my pond'}</button>
    </form>

    ${saved ? `
    <section class="card card--sticky">
      <h2 class="card__title">Match my card</h2>
      <p class="card__hint">Started mid-semester, or the numbers drifted? Enter what your card shows and the app logs an adjustment.</p>
      <div class="grid-2">
        <label class="field">Swipes now<input id="match-swipes" type="number" inputmode="numeric" min="0" step="1" placeholder="${esc(count(b.swipes.balance))}"></label>
        <label class="field">Points now<input id="match-points" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${esc(b.points.balance.toFixed(2))}"></label>
      </div>
      <button type="button" class="btn-sketch" id="match-go">Match</button>
    </section>` : ''}

    <section class="card">
      <h2 class="card__title">Look</h2>
      <div class="seg" role="group" aria-label="Color theme">
        ${THEMES.map(([id, label]) => `<button type="button" data-set-theme="${id}" aria-pressed="${theme === id}">${label}</button>`).join('')}
      </div>
    </section>

    ${saved ? `
    <section class="card">
      <h2 class="card__title card__title--danger">Danger zone</h2>
      <button type="button" class="btn-plain btn-plain--danger" id="reset">Erase all data on this device</button>
    </section>` : ''}`;

  renderDaysOff(root);
  const form = root.querySelector('#settings-form');
  
  root.querySelector('#p-save').addEventListener('click', async () => {
    const frogName = root.querySelector('#p-frog').value.trim() || 'Pip';
    await saveProfile({ nickname: root.querySelector('#p-nick').value.trim(), frogName });
    toast(`Hi from ${frogName}!`);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = readForm(form);
    const problem = problemWith(next);
    if (problem) return toast(problem);
    await saveSettings({ ...(saved ?? {}), ...next });
    if (!saved) { location.hash = '#/pond'; toast('Welcome to the pond!'); } else { toast('Saved!'); }
  });

  root.querySelector('#off-add').addEventListener('click', () => {
    const from = root.querySelector('#off-from').value;
    const to = root.querySelector('#off-to').value || from;
    const label = root.querySelector('#off-label').value.trim() || 'Day off';
    if (!from) return toast('Pick the first day off.');
    if (to < from) return toast('The last day is before the first day.');
    draftDaysOff.push({ from, to, label });
    draftDaysOff.sort((a, c) => a.from.localeCompare(c.from));
    ['#off-from', '#off-to', '#off-label'].forEach((sel) => { root.querySelector(sel).value = ''; });
    renderDaysOff(root);
  });

  root.querySelector('#days-off-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    draftDaysOff.splice(Number(btn.dataset.remove), 1);
    renderDaysOff(root);
  });

  root.querySelector('.seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-set-theme]');
    if (!btn) return;
    setTheme(btn.dataset.setTheme);
    applyTheme(btn.dataset.setTheme);
    root.querySelectorAll('[data-set-theme]').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
  });

  root.querySelector('#match-go')?.addEventListener('click', async () => {
    const current = budget(await getSettings(), await getEntries(), todayKey());
    const swRaw = root.querySelector('#match-swipes').value;
    const ptRaw = root.querySelector('#match-points').value;
    if (!swRaw && !ptRaw) return toast('Type what your card shows first.');
    let changed = 0;
    if (swRaw) {
      const sw = Number(swRaw);
      if (!Number.isInteger(sw) || sw < 0) return toast('Swipes must be a whole number.');
      const d = sw - current.swipes.balance;
      if (d !== 0) { await addEntry({ type: 'adjust-swipes', amount: d }); changed++; }
    }
    if (ptRaw) {
      const d = Math.round((Number(ptRaw) - current.points.balance) * 100) / 100;
      if (d !== 0) { await addEntry({ type: 'adjust-points', amount: d }); changed++; }
    }
    toast(changed ? 'Balances updated.' : 'Already matches your card!');
    renderSettings(root);
  });

  root.querySelector('#reset')?.addEventListener('click', async () => {
    if (!confirm('Erase your semester and every entry on this device? This can’t be undone.')) return;
    await resetAll();
    renderSettings(root);
  });
}