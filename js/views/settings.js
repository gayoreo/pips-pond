import {
  getSettings, saveSettings, getEntries, addEntry, resetAll, getTheme, setTheme, getProfile, saveProfile,
} from '../data/db.js';
import { budget, exchangeDaysOf, DEFAULT_EXCHANGE_DAYS } from '../core/calc.js';
import { learnWeights } from '../core/weights.js';
import { todayKey, addDays, formatShort } from '../core/dates.js';
import { seasonName } from '../core/semester.js';
import { esc, count, money, plural, applyTheme } from '../ui/dom.js';
import { infoBtn } from '../ui/info.js';
import { setSoundEnabled, play } from '../ui/sound.js';
import { toast } from '../ui/toast.js';
import { cloudEnabled, userNow } from '../data/supabase.js';
import { myProfile, signOut } from '../data/auth.js';
import { syncNow, syncState, SYNC_EVENT } from '../data/sync.js';
import { lockEnabled, lockSupported, enableLock, disableLock } from '../ui/lock.js';
import { pushStatus, enablePush, disablePush, sendTestPush } from '../data/push.js';
import { incomingCount, FRIENDS_EVENT } from '../data/social.js';

const SYNC_TEXT = {
  idle: 'Ready.', syncing: 'Syncing…', synced: 'All synced.', offline: 'Offline. It will sync when you’re back online.',
  error: 'Sync had trouble. It’ll retry.', 'signed-out': 'Signed out.',
};
const PUSH_TEXT = {
  unavailable: '', 'needs-account': 'Sign in to turn on reminders.',
  'needs-install': 'Add Pip’s Pond to your Home Screen first (Share → Add to Home Screen), then come back.',
  unsupported: 'This browser can’t do notifications.', denied: 'Blocked. Allow them in your phone’s Settings → Pip’s Pond.',
  off: '', on: '',
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const THEMES = [['paper', 'Paper'], ['night', 'Night'], ['auto', 'Match phone']];
let draftDaysOff = [];

function defaults() {
  const start = todayKey();
  return {
    semesterName: seasonName(start), start, end: addDays(start, 104), weekStart: 0,
    swipesTotal: '', pointsTotal: '', swipesRollover: false, pointsRollover: false,
    exchangeLimit: 2, exchangeUsesSwipe: false, exchangeDays: DEFAULT_EXCHANGE_DAYS, guestTotal: 0,
    daysOff: [], keypad: 'regular', logView: 'calendar', weightMode: 'auto',
    sounds: true, weeklyRecap: true, reportCard: true,
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
  const num = (k) => (String(f.get(k) ?? '').trim() === '' ? NaN : Number(f.get(k)));
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
    guestTotal: Number.isFinite(num('guestTotal')) ? num('guestTotal') : 0,
    exchangeLimit: num('exchangeLimit'),
    exchangeUsesSwipe: f.has('exchangeUsesSwipe'),
    exchangeDays: f.getAll('exchangeDays').map(Number),
    keypad: String(f.get('keypad')),
    logView: String(f.get('logView')),
    weightMode: String(f.get('weightMode')),
    sounds: f.has('sounds'),
    weeklyRecap: f.has('weeklyRecap'),
    reportCard: f.has('reportCard'),
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
  if (!whole(s.guestTotal)) return 'Guest passes must be a whole number (0 is fine).';
  return null;
}

function weightsText(settings, entries) {
  const learned = learnWeights(settings, entries, todayKey());
  if (learned.days < 21) return `Learning… ${learned.days} of 21 days logged so far. Until then every day gets the same share.`;
  const short = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `Learned from ${learned.days} days: ${learned.weights.map((w, i) => `${short[i]} ×${w}`).join(' · ')}`;
}

export async function renderSettings(root) {
  const saved = await getSettings();
  const s = { ...defaults(), ...(saved ?? {}) };
  draftDaysOff = (s.daysOff ?? []).map((d) => ({ ...d }));
  const exDays = exchangeDaysOf(s);
  const entries = await getEntries();
  const b = saved ? budget(saved, entries, todayKey()) : null;
  const theme = getTheme();
  const profile = await getProfile();
  const rolledIn = (Number(s.swipesRolledIn) || 0) || (Number(s.pointsRolledIn) || 0);

  // Account / sync / lock / notifications
  const user = cloudEnabled ? userNow() : null;
  const acct = user ? await myProfile().catch(() => null) : null;
  const lockOk = await lockSupported();
  const lockOn = lockEnabled();
  const push = await pushStatus();
  const notify = profile.notify ?? {};

  root.innerHTML = `
  <div class="settings-page stack">
    <header>
      ${saved ? '' : '<p class="eyebrow">Welcome to the Pond</p>'}
      <h1 class="page-title">${saved ? 'Settings' : 'Let’s set up your pond'}</h1>
    </header>

    ${cloudEnabled ? (user ? `
    <section class="card">
      <h2 class="card__title">Your account</h2>
      <p class="card__hint">${esc(user.email ?? 'Signed in')}${acct?.username ? ` · @${esc(acct.username)}` : ''}</p>
      <p class="card__hint" id="sync-status">${esc(SYNC_TEXT[syncState.status] ?? '')}</p>
      <div class="row">
        <button type="button" class="btn-sketch" id="sync-now">Sync now</button>
        <a class="btn-plain" href="#/friends">Pond friends →${incomingCount() ? ` <span class="badge" aria-label="${incomingCount()} pending ${incomingCount() === 1 ? 'request' : 'requests'}">${incomingCount()}</span>` : ''}</a>
      </div>
      <button type="button" class="btn-plain btn-plain--danger" id="sign-out">Sign out of this device</button>
    </section>

    <section class="card">
      <h2 class="card__title">Notifications ${infoBtn('Pip can remind you to log each day, tell you when you go over for the week, and warn you before the semester ends. Friend snacks and cheers show up here too.')}</h2>
      <div id="push-box">
        ${push === 'on' ? `
          <p class="card__hint">Reminders are on for this device.</p>
          <label class="row"><span>Daily nudge if I forget to log</span><input type="checkbox" class="switch" data-notify="nudge"${notify.nudge !== false ? ' checked' : ''}></label>
          <label class="field" id="nudge-time-row"${notify.nudge === false ? ' hidden' : ''}>Nudge me at<input type="time" id="nudge-time" value="${esc(notify.nudgeTime || '19:00')}"></label>
          <label class="row"><span>Tell me when I go over for the week</span><input type="checkbox" class="switch" data-notify="pace"${notify.pace !== false ? ' checked' : ''}></label>
          <label class="row"><span>Semester-ending reminders</span><input type="checkbox" class="switch" data-notify="semesterEnd"${notify.semesterEnd !== false ? ' checked' : ''}></label>
          <label class="row"><span>Friend snacks, cheers &amp; visits</span><input type="checkbox" class="switch" data-notify="friends"${notify.friends !== false ? ' checked' : ''}></label>
          <div class="row">
            <button type="button" class="btn-plain" id="push-test">Send a test</button>
            <button type="button" class="btn-plain btn-plain--muted" id="push-off">Turn off on this device</button>
          </div>
        ` : `
          <p class="card__hint">${esc(PUSH_TEXT[push] || 'Pip can remind you to log and warn you before you run low.')}</p>
          ${['off'].includes(push) ? '<button type="button" class="btn-sketch btn-sketch--go" id="push-on">Turn on reminders</button>' : ''}
        `}
      </div>
    </section>

    ${lockOk ? `
    <section class="card">
      <h2 class="card__title">Face ID lock ${infoBtn('Locks the app on this device with Face ID, Touch ID or your device PIN. You stay signed in, so you won’t need your password to get back in.')}</h2>
      <label class="row"><span>Lock this device with Face ID</span><input type="checkbox" class="switch" id="lock-toggle"${lockOn ? ' checked' : ''}></label>
    </section>` : ''}
    ` : `
    <section class="card">
      <h2 class="card__title">Sync &amp; friends</h2>
      <p class="card__hint">Sign in to sync your pond between your phone and computer, back it up, and add pond friends.</p>
      <a class="btn-sketch btn-sketch--go" href="#/login">Sign in or make an account</a>
    </section>`) : ''}

    <section class="card">
      <h2 class="card__title">You &amp; your companion</h2>
      <div class="grid-2">
        <label class="field">Your nickname<input id="p-nick" maxlength="24" autocomplete="nickname" value="${esc(profile.nickname)}"></label>
        <label class="field">Companion s name<input id="p-frog" maxlength="24" autocomplete="off" value="${esc(profile.frogName)}"></label>
      </div>
      <label class="field">Companion style
        <select id="p-companion">
          <option value="frog"${profile.companion !== 'sandshrew' ? ' selected' : ''}>Pip (Frog)</option>
          <option value="sandshrew"${profile.companion === 'sandshrew' ? ' selected' : ''}>Sandshrew</option>
        </select>
      </label>
      <div class="row">
        <button type="button" class="btn-sketch" id="p-save">Save details</button>
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
        <label class="field"><span class="field__label">Week starts on ${infoBtn('The day your weekly things reset: the swipe pool refills and the exchange stamps clear. Match it to your school’s meal plan week.')}</span>
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
        ${rolledIn ? `<p class="card__hint">Plus rolled over from ${esc(s.rolledFrom ?? 'last semester')}: ${plural(Number(s.swipesRolledIn) || 0, 'swipe')} and ${money(Number(s.pointsRolledIn) || 0)}.</p>` : ''}
        <label class="row"><span>Leftover swipes carry over ${infoBtn('When you start next semester, unused swipes are added to it. Leave off if your school resets swipes each semester.')}</span><input type="checkbox" class="switch" name="swipesRollover"${s.swipesRollover ? ' checked' : ''}></label>
        <label class="row"><span>Leftover points carry over ${infoBtn('When you start next semester, unused points are added to it. Many schools roll points from fall to spring only.')}</span><input type="checkbox" class="switch" name="pointsRollover"${s.pointsRollover ? ' checked' : ''}></label>
        <label class="field"><span class="field__label">Guest passes / semester ${infoBtn('Guest swipes for friends or family, if your plan has them. They’re tracked separately and don’t use your own swipes. 0 hides the guest counter.')}</span>
          <input type="number" name="guestTotal" inputmode="numeric" min="0" step="1" value="${esc(s.guestTotal || 0)}"></label>
      </section>

      <section class="card">
        <h2 class="card__title card__title--plum">Exchanges</h2>
        <label class="field">Max per week<input type="number" name="exchangeLimit" inputmode="numeric" min="0" step="1" value="${esc(s.exchangeLimit)}"></label>
        <fieldset class="days-pick">
          <legend class="field">Allowed on ${infoBtn('Exchanges can only be logged on these days. On other days the exchange button is greyed out.')}</legend>
          ${DAYS.map((d, i) => `
            <label class="daychip"><input type="checkbox" name="exchangeDays" value="${i}"${exDays.includes(i) ? ' checked' : ''}><span>${d.slice(0, 3)}</span></label>`).join('')}
        </fieldset>
        <label class="row"><span>An exchange also uses a swipe ${infoBtn('Turn on if each meal exchange also takes one swipe from your balance. Off means exchanges only count toward the weekly limit.')}</span><input type="checkbox" class="switch" name="exchangeUsesSwipe"${s.exchangeUsesSwipe ? ' checked' : ''}></label>
        <p class="card__hint">Resets each week. Unused exchanges don’t carry over.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Days off (naptime) ${infoBtn('Breaks and holidays when you won’t eat on campus. They’re left out of the daily points budget and the swipe pool, and the frog naps.')}</h2>
        <div class="chip-row" id="days-off-list"></div>
        <div class="grid-2">
          <label class="field">First day<input type="date" id="off-from"></label>
          <label class="field">Last day<input type="date" id="off-to"></label>
        </div>
        <label class="field">Label<input id="off-label" maxlength="40" autocomplete="off"></label>
        <button type="button" class="btn-sketch" id="off-add">+ add days off</button>
        <p class="card__hint">Remember to save.</p>
      </section>

      <section class="card">
        <h2 class="card__title">Budget &amp; logging</h2>
        <label class="field"><span class="field__label">Daily points split ${infoBtn('Auto-learn: after 3 weeks, days you usually spend more on (like weekdays) get a bigger share of your daily points. Equal: every eating day gets the same amount.')}</span>
          <select name="weightMode">
            <option value="auto"${s.weightMode !== 'equal' ? ' selected' : ''}>Auto-learn my habits</option>
            <option value="equal"${s.weightMode === 'equal' ? ' selected' : ''}>Every day equal</option>
          </select>
        </label>
        ${saved && s.weightMode !== 'equal' ? `<p class="card__hint">${esc(weightsText(saved, entries))}</p>` : ''}
        <label class="field"><span class="field__label">Keypad ${infoBtn('Type the dot: you tap 4 . 7 5. Cents: you tap 4 7 5 and it fills in the cents, like a cash register.')}</span>
          <select name="keypad">
            <option value="regular"${s.keypad !== 'cents' ? ' selected' : ''}>Type the dot (4 . 7 5)</option>
            <option value="cents"${s.keypad === 'cents' ? ' selected' : ''}>Cents (4 7 5 → $4.75)</option>
          </select>
        </label>
        <label class="field"><span class="field__label">Log tab layout ${infoBtn('Calendar shows a month with a mood stamp per day. Journal shows scrolling day pages. You can also switch from the Log tab.')}</span>
          <select name="logView">
            <option value="calendar"${s.logView !== 'journal' ? ' selected' : ''}>Calendar + day page</option>
            <option value="journal"${s.logView === 'journal' ? ' selected' : ''}>Journal pages</option>
          </select>
        </label>
        <label class="row"><span>Sounds ${infoBtn('Little chomp and ribbit sounds when you log or pet the frog. Phones that support it buzz too.')}</span><input type="checkbox" class="switch" name="sounds"${s.sounds !== false ? ' checked' : ''}></label>
        <label class="row"><span>Weekly recap ${infoBtn('At the start of each week, a note on the Pond sums up last week.')}</span><input type="checkbox" class="switch" name="weeklyRecap"${s.weeklyRecap !== false ? ' checked' : ''}></label>
        <label class="row"><span>Semester report card ${infoBtn('When the semester ends, the Pond shows a report card with your stats and a grade.')}</span><input type="checkbox" class="switch" name="reportCard"${s.reportCard !== false ? ' checked' : ''}></label>
        ${saved ? '<a class="btn-plain" href="#/favorites">Edit favorites →</a>' : ''}
      </section>

      <button type="submit" class="btn-sketch btn-sketch--go btn-sketch--big">${saved ? 'Save changes' : 'Start my pond'}</button>
    </form>

    ${saved ? `
    <section class="card card--sticky">
      <h2 class="card__title">Match my card ${infoBtn('Enter what your school card or dining app shows right now. The app logs a “balance fix” for the difference, so your history stays intact.')}</h2>
      <p class="card__hint">Started mid-semester, or the numbers drifted? Enter what your card shows and the app logs an adjustment.</p>
      <div class="grid-2">
        <label class="field">Swipes now<input id="match-swipes" type="number" inputmode="numeric" min="0" step="1" placeholder="${esc(count(b.swipes.balance))}"></label>
        <label class="field">Points now<input id="match-points" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${esc(b.points.balance.toFixed(2))}"></label>
      </div>
      <button type="button" class="btn-sketch" id="match-go">Match</button>
    </section>

    <section class="card">
      <h2 class="card__title">Add funds ${infoBtn('Bought more points or swipes mid-semester? Add them here and your budget re-balances from the new total.')}</h2>
      <div class="grid-2">
        <label class="field">Points added ($)<input id="fund-points" type="number" inputmode="decimal" min="0" step="0.01"></label>
        <label class="field">Swipes added<input id="fund-swipes" type="number" inputmode="numeric" min="0" step="1"></label>
      </div>
      <button type="button" class="btn-sketch" id="fund-go">Add</button>
    </section>

    <section class="card">
      <h2 class="card__title">Semesters &amp; your data ${infoBtn('See past semesters and their report cards, start the next semester, download your data, or import your school’s transaction history.')}</h2>
      <a class="btn-plain" href="#/semesters">Semester history &amp; next semester →</a>
      <a class="btn-plain" href="#/data">Export, import &amp; backups →</a>
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
    </section>` : ''}
  </div>`;

  renderDaysOff(root);
  const form = root.querySelector('#settings-form');

  root.querySelector('#p-save').addEventListener('click', async () => {
    const frogName = root.querySelector('#p-frog').value.trim() || 'Pip';
    const companion = root.querySelector('#p-companion').value;
    await saveProfile({ nickname: root.querySelector('#p-nick').value.trim(), frogName, companion });
    toast(`Hi from ${frogName}!`);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = readForm(form);
    const problem = problemWith(next);
    if (problem) return toast(problem);
    await saveSettings({ ...(saved ?? {}), ...next });
    setSoundEnabled(next.sounds);
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

  root.querySelector('#fund-go')?.addEventListener('click', async () => {
    const pt = Number(root.querySelector('#fund-points').value || 0);
    const sw = Number(root.querySelector('#fund-swipes').value || 0);
    if (!(pt > 0) && !(sw > 0)) return toast('Enter how much you added.');
    if (sw && !Number.isInteger(sw)) return toast('Swipes must be a whole number.');
    if (pt > 0) await addEntry({ type: 'fund-points', amount: Math.round(pt * 100) / 100 });
    if (sw > 0) await addEntry({ type: 'fund-swipes', amount: sw });
    play('pop');
    toast('Added! Your budget re-balanced.');
    renderSettings(root);
  });

  root.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast('Link copied!');
    } catch {
      toast('Couldn’t copy. Press and hold the link to copy it.');
    }
  }));

  root.querySelector('#sync-now')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    await syncNow();
    e.target.disabled = false;
    toast(SYNC_TEXT[syncState.status] ?? 'Done.');
  });

  if (!renderSettings._syncWired) {
    renderSettings._syncWired = true;
    window.addEventListener(SYNC_EVENT, () => {
      const el = document.getElementById('sync-status');
      if (el) el.textContent = SYNC_TEXT[syncState.status] ?? '';
    });
  }

  // Re-render when friends arrive/change (so the pending-requests badge stays current).
  if (!renderSettings._friendsWired) {
    renderSettings._friendsWired = true;
    window.addEventListener(FRIENDS_EVENT, () => { if (location.hash === '#/settings') renderSettings(root); });
  }

  root.querySelector('#sign-out')?.addEventListener('click', async () => {
    if (!confirm('Sign out and remove your pond from this device? Your data stays safe in your account.')) return;
    const res = await signOut();
    if (res.unsynced > 0 &&
        confirm(`${res.unsynced} change(s) haven’t synced yet (you may be offline). Sign out anyway and lose them from this device?`)) {
      await signOut({ force: true });
    } else if (res.unsynced > 0) {
      return;
    }
    location.hash = '#/login';
  });

  root.querySelectorAll('[data-notify]').forEach((box) => box.addEventListener('change', async () => {
    const next = { ...(await getProfile()).notify };
    next[box.dataset.notify] = box.checked;
    await saveProfile({ notify: next });
    const timeRow = root.querySelector('#nudge-time-row');
    if (box.dataset.notify === 'nudge' && timeRow) timeRow.hidden = !box.checked;
    syncNow();
  }));
  root.querySelector('#nudge-time')?.addEventListener('change', async (e) => {
    await saveProfile({ notify: { ...(await getProfile()).notify, nudgeTime: e.target.value || '19:00' } });
    syncNow();
    toast('Reminder time saved.');
  });

  root.querySelector('#push-on')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await enablePush(); toast('Reminders on!'); renderSettings(root); }
    catch (err) { toast(err.message, 4000); e.target.disabled = false; }
  });
  root.querySelector('#push-off')?.addEventListener('click', async () => {
    await disablePush();
    toast('Reminders off for this device.');
    renderSettings(root);
  });
  root.querySelector('#push-test')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const n = await sendTestPush(); toast(n ? 'Test sent!' : 'No devices are on yet.'); }
    catch (err) { toast(err.message, 4000); }
    finally { e.target.disabled = false; }
  });

  root.querySelector('#lock-toggle')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      try { await enableLock(user?.email || 'Pip’s Pond'); toast('Face ID lock on.'); }
      catch { e.target.checked = false; toast('Face ID setup was cancelled.'); }
    } else {
      disableLock();
      toast('Face ID lock off.');
    }
  });

  root.querySelector('#reset')?.addEventListener('click', async () => {
    if (!confirm('Erase your semester, past semesters, and every entry on this device? This can’t be undone.')) return;
    await resetAll();
    location.hash = '#/welcome';
  });
}
