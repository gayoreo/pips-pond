// First-run tutorial: hello → practice pond → setup (3 grouped screens) → naming → move-in.
// Also used for "Replay tutorial" (hello + practice only) and "Start next semester" (setup only).
import { getProfile, saveProfile, getSettings, saveSettings, getEntries, addEntry, startNewSemester } from '../data/db.js';
import { budget, DEFAULT_EXCHANGE_DAYS } from '../core/calc.js';
import { todayKey, addDays, startOfWeek, formatLong, formatShort, eatingDays } from '../core/dates.js';
import { seasonName } from '../core/semester.js';
import { moodFor } from '../pip/mood.js';
import { outfitFor } from '../pip/frog.js';
import { esc, money, count, plural } from '../ui/dom.js';
import { noteHTML, stampsHTML, pondSceneHTML } from '../ui/widgets.js';
import { infoBtn } from '../ui/info.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FLOWS = {
  first: ['hello', 'practice', 'semester', 'plan', 'extras', 'name'],
  replay: ['hello', 'practice', 'done'],
  semester: ['semester', 'plan', 'extras'],
};

// Tutorial state lives here while the tutorial is open.
const t = { mode: null, step: 0, draft: null, demo: null, bubble: '', eatUntil: 0 };

// ---------- entry points ----------
export function beginNewSemester(prefill) {
  t.mode = 'semester';
  t.step = 0;
  t.draft = { ...defaultDraft({}), ...prefill, matchSwipes: '', matchPoints: '' };
  t.bubble = '';
  location.hash = '#/setup';
}

export async function renderSetup(root) {
  if (t.mode !== 'semester') { location.hash = '#/settings'; return; }
  return render(root);
}

export async function renderTutorial(root) {
  const hasSettings = Boolean(await getSettings());
  const wanted = hasSettings ? 'replay' : 'first';
  if (t.mode !== wanted) {
    const profile = await getProfile();
    t.mode = wanted;
    t.step = 0;
    t.draft = defaultDraft(profile);
    t.demo = null;
    t.bubble = '';
  }
  return render(root);
}

// ---------- draft (answers) ----------
function defaultDraft(profile) {
  const start = todayKey();
  return {
    semesterName: seasonName(start), start, end: addDays(start, 104), weekStart: 0,
    swipesTotal: '', pointsTotal: '', swipesRollover: false, pointsRollover: false,
    exchangeLimit: 2, exchangeDays: [...DEFAULT_EXCHANGE_DAYS], exchangeUsesSwipe: false, guestTotal: 0,
    daysOff: [], matchSwipes: '', matchPoints: '',
    keypad: 'regular', logView: 'calendar', weightMode: 'auto', sounds: true, weeklyRecap: true, reportCard: true,
    nickname: profile.nickname ?? '', frogName: profile.frogName || 'Pip',
  };
}

const SETTING_KEYS = [
  'semesterName', 'start', 'end', 'weekStart', 'swipesTotal', 'pointsTotal', 'swipesRollover', 'pointsRollover',
  'exchangeLimit', 'exchangeDays', 'exchangeUsesSwipe', 'guestTotal', 'daysOff', 'keypad', 'logView',
  'weightMode', 'sounds', 'weeklyRecap', 'reportCard', 'swipesRolledIn', 'pointsRolledIn', 'rolledFrom',
];
const settingsFromDraft = (d) => Object.fromEntries(SETTING_KEYS.filter((k) => k in d).map((k) => [k, d[k]]));

// ---------- practice pond (demo data, never saved) ----------
function newDemo() {
  const monday = startOfWeek(todayKey(), 1);
  return {
    settings: {
      start: monday, end: addDays(monday, 55), weekStart: 1,
      swipesTotal: 24, pointsTotal: 280, exchangeLimit: 2, exchangeDays: [1, 2, 3, 4, 5],
      exchangeUsesSwipe: false, daysOff: [], weightMode: 'equal',
    },
    entries: [],
    today: monday,
    done: { swipe: false, points: false, exchange: false, day: false },
    pad: null, // keypad text when open
  };
}

const demoBudget = () => budget(t.demo.settings, t.demo.entries, t.demo.today);

function practiceHTML(name) {
  t.demo ??= newDemo();
  const b = demoBudget();
  const mood = Date.now() < t.eatUntil ? 'eating' : moodFor(b);
  const d = t.demo.done;
  const bubble = t.bubble || 'This is a practice pond. Tap the buttons, nothing here is saved!';
  return `
  <div class="tut-practice">
    <div class="tut-practice__pond">
      ${pondSceneHTML({ mood, name, outfit: outfitFor(t.demo.today) })}
      <p class="bubble" aria-live="polite">${esc(bubble)}</p>
    </div>
    <div class="tut-practice__panel stack">
      <p class="eyebrow">Practice pond · ${formatLong(t.demo.today)}</p>
      <div class="notes">
        ${noteHTML('swipes', 'Swipes', b.swipes, count)}
        ${noteHTML('points', 'Points', b.points, money)}
      </div>
      ${stampsHTML(b.exchanges, null)}
      <div class="feed-row">
        <button type="button" class="btn-sketch btn-sketch--swipe" data-demo="swipe">a swipe</button>
        <button type="button" class="btn-sketch btn-sketch--points" data-demo="points">points</button>
        <button type="button" class="btn-sketch btn-sketch--exchange" data-demo="exchange">exchange</button>
      </div>
      ${t.demo.pad !== null ? `
      <div class="mini-pad">
        <output class="amount__value" aria-live="polite">$${esc(t.demo.pad || '0')}</output>
        <div class="keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => `<button type="button" data-pad="${k}" aria-label="${k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}"${k === '.' ? ' class="key-dot"' : ''}>${k}</button>`).join('')}
        </div>
        <button type="button" class="btn-sketch btn-sketch--go" data-demo="spend">spend it</button>
      </div>` : ''}
      <button type="button" class="btn-sketch" data-demo="day">next day →</button>
      <ul class="checklist" aria-label="Things to try">
        <li class="${d.swipe ? 'is-done' : ''}">Feed a swipe</li>
        <li class="${d.points ? 'is-done' : ''}">Spend points with the keypad</li>
        <li class="${d.exchange ? 'is-done' : ''}">Use an exchange</li>
        <li class="${d.day ? 'is-done' : ''}">Skip to the next day</li>
      </ul>
    </div>
  </div>`;
}

function eat() {
  t.eatUntil = Date.now() + 1100;
  setTimeout(() => { if (location.hash === '#/welcome') rerender(); }, 1150);
}

function demoAction(kind) {
  const demo = t.demo;
  const b = demoBudget();
  if (kind === 'swipe') {
    const before = b.swipes.leftToday;
    demo.entries.push({ type: 'swipe', amount: 1, date: demo.today });
    const after = demoBudget().swipes.leftToday;
    demo.done.swipe = true;
    t.bubble = after >= 0
      ? `Chomp! ${before} → ${after} swipes left this week. Swipes are a weekly pool.`
      : 'Uh oh, that’s more than this week’s pool. I’m sad! Next week refills it.';
    eat(); play('chomp');
  } else if (kind === 'points') {
    demo.pad = demo.pad === null ? '' : null;
    t.bubble = demo.pad === null ? t.bubble : `Type what you spent. Today you have ${money(b.points.leftToday)}.`;
  } else if (kind === 'spend') {
    const n = parseFloat(demo.pad || '0');
    if (!(n > 0)) { t.bubble = 'Type an amount first!'; return; }
    demo.entries.push({ type: 'points', amount: n, date: demo.today });
    demo.pad = null;
    demo.done.points = true;
    const nb = demoBudget();
    t.bubble = nb.points.leftToday < -0.004
      ? `Oof, that’s ${money(-nb.points.leftToday)} over today. Tap “next day” and watch me bounce back!`
      : `Yum! ${money(nb.points.leftToday)} left today. Spend less today and tomorrow gets more.`;
    eat(); play(n > b.points.daily ? 'whoa' : 'chomp');
  } else if (kind === 'exchange') {
    if (!b.exchanges.allowedToday) {
      t.bubble = 'No exchanges on weekends! You pick the allowed days during setup.';
      demo.done.exchange = true;
      return;
    }
    demo.entries.push({ type: 'exchange', amount: 1, date: demo.today });
    demo.done.exchange = true;
    const used = demoBudget().exchanges.used;
    t.bubble = used <= 2 ? `Stamped! ${used} of 2 exchanges this week. They reset weekly.` : 'That’s past the weekly limit, so the stamp turns red.';
    play('stamp');
  } else if (kind === 'day') {
    const prevWeek = startOfWeek(demo.today, 1);
    demo.today = addDays(demo.today, 1);
    demo.done.day = true;
    if (demo.today > demo.settings.end) { t.demo = newDemo(); t.bubble = 'Practice semester’s over! Starting a fresh one.'; return; }
    const nb = demoBudget();
    const weekend = !nb.exchanges.allowedToday ? ' It’s the weekend, so exchanges are off today.' : '';
    t.bubble = startOfWeek(demo.today, 1) !== prevWeek
      ? `New week! Your swipe pool refilled to ${nb.swipes.weekly}.${weekend}`
      : `New day! Today’s points: ${money(nb.points.daily)}, re-balanced from what’s left.${weekend}`;
    play('pop');
  }
}

function padPress(key) {
  let a = t.demo.pad ?? '';
  if (key === 'del') a = a.slice(0, -1);
  else if (key === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
  else if (!(a.includes('.') && a.split('.')[1].length >= 2) && a.replace('.', '').length < 5) a = a === '0' ? key : a + key;
  t.demo.pad = a;
}

// ---------- setup screens ----------
const field = (label, input, info) =>
  `<label class="field"><span class="field__label">${label}${info ? ` ${infoBtn(info)}` : ''}</span>${input}</label>`;

function semesterHTML(d) {
  return `
  <div class="stack">
    ${field('Semester name', `<input name="semesterName" value="${esc(d.semesterName)}" maxlength="40" autocomplete="off">`)}
    <div class="grid-2">
      ${field('Starts', `<input type="date" name="start" value="${esc(d.start)}">`)}
      ${field('Ends', `<input type="date" name="end" value="${esc(d.end)}">`)}
    </div>
    ${field('Week starts on', `<select name="weekStart">${DAYS.map((x, i) => `<option value="${i}"${Number(d.weekStart) === i ? ' selected' : ''}>${x}</option>`).join('')}</select>`,
      'The day your school resets weekly things like meal exchanges. Your swipe pool also refills on this day.')}
  </div>`;
}

function planHTML(d) {
  return `
  <div class="stack">
    <div class="grid-2">
      ${field('Swipes / semester', `<input type="number" name="swipesTotal" inputmode="numeric" min="0" step="1" value="${esc(d.swipesTotal)}">`)}
      ${field('Points / semester ($)', `<input type="number" name="pointsTotal" inputmode="decimal" min="0" step="0.01" value="${esc(d.pointsTotal)}">`)}
    </div>
    ${d.swipesRolledIn || d.pointsRolledIn ? `<p class="card__hint">Plus rolled over from ${esc(d.rolledFrom ?? 'last semester')}: ${plural(d.swipesRolledIn || 0, 'swipe')} and ${money(d.pointsRolledIn || 0)}.</p>` : ''}
    <label class="row"><span>Leftover swipes carry over ${infoBtn('When this semester ends, unused swipes get added to next semester. Leave off if your school resets them.')}</span><input type="checkbox" class="switch" name="swipesRollover"${d.swipesRollover ? ' checked' : ''}></label>
    <label class="row"><span>Leftover points carry over ${infoBtn('When this semester ends, unused points get added to next semester.')}</span><input type="checkbox" class="switch" name="pointsRollover"${d.pointsRollover ? ' checked' : ''}></label>
    ${field('Meal exchanges per week', `<input type="number" name="exchangeLimit" inputmode="numeric" min="0" step="1" value="${esc(d.exchangeLimit)}">`)}
    <fieldset class="days-pick">
      <legend class="field">Exchanges allowed on</legend>
      ${DAYS.map((x, i) => `<label class="daychip"><input type="checkbox" name="exchangeDays" value="${i}"${d.exchangeDays.includes(i) ? ' checked' : ''}><span>${x.slice(0, 3)}</span></label>`).join('')}
    </fieldset>
    <label class="row"><span>An exchange also uses a swipe ${infoBtn('Turn on if each retail meal exchange takes one swipe from your balance.')}</span><input type="checkbox" class="switch" name="exchangeUsesSwipe"${d.exchangeUsesSwipe ? ' checked' : ''}></label>
    ${field('Guest passes / semester (optional)', `<input type="number" name="guestTotal" inputmode="numeric" min="0" step="1" value="${esc(d.guestTotal || '')}">`,
      'Some plans include guest swipes for friends or family. They’re counted separately.')}
  </div>`;
}

function extrasHTML(d) {
  const started = d.start < todayKey();
  return `
  <div class="stack">
    <section class="card">
      <h2 class="card__title">Days off <span class="muted">(optional)</span></h2>
      <div class="chip-row" id="tut-days-off">${daysOffChips(d)}</div>
      <div class="grid-2">
        ${field('First day', '<input type="date" id="off-from">')}
        ${field('Last day', '<input type="date" id="off-to">')}
      </div>
      ${field('Label', '<input id="off-label" maxlength="40" autocomplete="off">')}
      <button type="button" class="btn-sketch" data-off-add>+ add days off</button>
    </section>
    ${started ? `
    <section class="card card--sticky">
      <h2 class="card__title">Match my card <span class="muted">(optional)</span></h2>
      <p class="card__hint">Your semester already started. What does your card say right now?</p>
      <div class="grid-2">
        ${field('Swipes now', `<input type="number" name="matchSwipes" inputmode="numeric" min="0" step="1" value="${esc(d.matchSwipes)}">`)}
        ${field('Points now', `<input type="number" name="matchPoints" inputmode="decimal" min="0" step="0.01" value="${esc(d.matchPoints)}">`)}
      </div>
    </section>` : ''}
  </div>`;
}

function daysOffChips(d) {
  return d.daysOff.length
    ? d.daysOff.map((x, i) => `<span class="tape">${esc(x.label)} · ${x.from === x.to ? formatShort(x.from) : `${formatShort(x.from)} – ${formatShort(x.to)}`}
        <button type="button" data-off-remove="${i}" aria-label="Remove ${esc(x.label)}">✕</button></span>`).join('')
    : '<p class="card__hint">No days off yet. You can add breaks later in Settings too.</p>';
}

function nameHTML(d) {
  return `
  <div class="stack">
    ${field('What should I call you?', `<input name="nickname" maxlength="24" autocomplete="nickname" value="${esc(d.nickname)}">`)}
    ${field('What’s my name?', `<input name="frogName" maxlength="24" autocomplete="off" value="${esc(d.frogName)}">`)}
  </div>`;
}

// Save whatever is typed on the current screen into the draft.
function readInputs(root) {
  const d = t.draft;
  root.querySelectorAll('.tutorial [name]').forEach((el) => {
    if (el.name === 'exchangeDays') return;
    if (el.type === 'checkbox') d[el.name] = el.checked;
    else d[el.name] = el.value;
  });
  if (root.querySelector('[name=exchangeDays]')) {
    d.exchangeDays = [...root.querySelectorAll('[name=exchangeDays]:checked')].map((x) => Number(x.value));
  }
}

function validate(stepName) {
  const d = t.draft;
  const whole = (v) => String(v).trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0;
  if (stepName === 'semester') {
    if (!d.start || !d.end) return 'Pick your semester’s start and end dates.';
    if (d.end < d.start) return 'The end date is before the start date.';
  }
  if (stepName === 'plan') {
    if (!whole(d.swipesTotal)) return 'Swipes must be a whole number (0 is fine).';
    if (String(d.pointsTotal).trim() === '' || !(Number(d.pointsTotal) >= 0)) return 'Enter your points (0 is fine).';
    if (!whole(d.exchangeLimit)) return 'Exchanges per week must be a whole number (0 is fine).';
    if (String(d.guestTotal).trim() !== '' && !whole(d.guestTotal)) return 'Guest passes must be a whole number.';
  }
  if (stepName === 'extras') {
    if (d.matchSwipes !== '' && !whole(d.matchSwipes)) return 'Swipes on your card must be a whole number.';
  }
  return null;
}

function reactionFor(stepName) {
  const d = t.draft;
  if (stepName === 'semester') {
    if (d.start && d.end && d.end >= d.start) {
      const weeks = Math.max(1, Math.round(eatingDays(d.start, d.end) / 7));
      return `${weeks} weeks of eating together? Let’s make it last!`;
    }
    return 'First, when is your semester?';
  }
  if (stepName === 'plan') {
    const sw = Number(d.swipesTotal);
    const pt = Number(d.pointsTotal);
    if (sw > 0 && pt > 0) return `${sw} swipes and ${money(pt)}? We’re gonna eat well!`;
    if (sw > 0) return `${sw} swipes? Ooh, that’s a lot of meals!`;
    if (pt > 0) return `${money(pt)} in points, fancy!`;
    return 'Now your meal plan. Your school’s dining site or app lists these numbers.';
  }
  if (stepName === 'extras') return 'Almost done! These are optional, so skip whatever doesn’t apply.';
  if (stepName === 'name') return 'One more thing…';
  return '';
}

// ---------- page ----------
const TITLES = {
  hello: (n) => `Hi! I’m ${n}.`,
  practice: () => 'Try feeding me',
  done: () => 'That’s the tour!',
  semester: () => 'Your semester',
  plan: () => 'Your meal plan',
  extras: () => 'Extras',
  name: () => 'What’s my name?',
};

let rootEl = null;
let lastFocused = '';
const rerender = () => rootEl && render(rootEl);

async function render(root) {
  rootEl = root;
  const flow = FLOWS[t.mode];
  const stepName = flow[t.step];
  const d = t.draft;
  const name = d.frogName || 'Pip';
  const setupSteps = flow.filter((s) => ['semester', 'plan', 'extras'].includes(s));
  const setupIdx = setupSteps.indexOf(stepName);
  const last = t.step === flow.length - 1;

  let body = '';
  let bubble = '';
  if (stepName === 'hello') {
    bubble = t.mode === 'first'
      ? 'I live on your meal plan. When you eat on campus, you feed me, and I keep your budget on pace so it lasts all semester. Want to practice?'
      : 'Welcome back! Here’s the practice pond again. Nothing you do here touches your real data.';
  } else if (stepName === 'practice') {
    body = practiceHTML(name);
  } else if (stepName === 'done') {
    bubble = 'That’s everything! Tap the (i) buttons in Settings any time you want a reminder.';
  } else if (stepName === 'semester') { body = semesterHTML(d); bubble = t.bubble || reactionFor('semester'); }
  else if (stepName === 'plan') { body = planHTML(d); bubble = t.bubble || reactionFor('plan'); }
  else if (stepName === 'extras') { body = extrasHTML(d); bubble = reactionFor('extras'); }
  else if (stepName === 'name') { body = nameHTML(d); bubble = reactionFor('name'); }

  const nextLabel = {
    hello: t.mode === 'first' ? 'Let’s practice!' : 'Show me',
    practice: t.mode === 'first' ? 'Set up my semester' : 'Finish tour',
    done: 'Back to the pond',
    semester: 'next',
    plan: 'next',
    extras: t.mode === 'semester' ? 'Start the semester' : 'next',
    name: 'Move in!',
  }[stepName];

  const showSkip = stepName === 'hello' || stepName === 'practice';

  root.innerHTML = `
  <div class="tutorial tutorial--${stepName}">
    <div class="tutorial__top">
      <span class="eyebrow">${setupIdx >= 0 ? `Setup ${setupIdx + 1} of ${setupSteps.length}` : t.mode === 'semester' ? 'New semester' : 'Welcome'}</span>
      ${showSkip ? `<button type="button" class="btn-plain btn-plain--muted" data-skip>${t.mode === 'first' ? 'skip the practice' : 'skip'}</button>` : ''}
      ${t.mode === 'semester' && t.step === 0 ? '<a class="btn-plain btn-plain--muted" href="#/semesters">cancel</a>' : ''}
    </div>
    <h1 class="page-title" tabindex="-1">${esc(TITLES[stepName](name))}</h1>
    ${stepName === 'practice' ? body : `
    <div class="tut-guide">
      <div class="tut-guide__frog">${pondSceneHTML({ mood: 'happy', name, outfit: outfitFor(todayKey()), tag: false, extraClass: 'pond--small' })}</div>
      ${bubble ? `<p class="bubble" aria-live="polite">${esc(bubble)}</p>` : ''}
    </div>
    ${body ? `<div class="tutorial__body">${body}</div>` : '<div class="tutorial__body"></div>'}`}
    <div class="tutorial__nav">
      <button type="button" class="btn-sketch" data-back${t.step === 0 ? ' disabled' : ''}>back</button>
      <button type="button" class="btn-sketch btn-sketch--go" data-next>${nextLabel}</button>
    </div>
  </div>`;

  const key = `${t.mode}:${t.step}`;
  if (key !== lastFocused) { root.querySelector('h1').focus({ preventScroll: true }); lastFocused = key; }
  const page = root.querySelector('.tutorial');

  page.addEventListener('input', () => {
    readInputs(root);
    const b = page.querySelector('.tut-guide .bubble');
    if (b && (stepName === 'semester' || stepName === 'plan')) { t.bubble = ''; b.textContent = reactionFor(stepName); }
  });

  page.addEventListener('click', async (e) => {
    const target = e.target;
    const demoBtn = target.closest('[data-demo]');
    if (demoBtn) { demoAction(demoBtn.dataset.demo); return rerender(); }
    const padBtn = target.closest('[data-pad]');
    if (padBtn) { padPress(padBtn.dataset.pad); page.querySelector('.mini-pad .amount__value').textContent = `$${t.demo.pad || '0'}`; return; }

    if (target.closest('[data-off-add]')) {
      const from = root.querySelector('#off-from').value;
      const to = root.querySelector('#off-to').value || from;
      const label = root.querySelector('#off-label').value.trim() || 'Day off';
      if (!from) return toast('Pick the first day off.');
      if (to < from) return toast('The last day is before the first day.');
      readInputs(root);
      d.daysOff = [...d.daysOff, { from, to, label }].sort((a, c) => a.from.localeCompare(c.from));
      return rerender();
    }
    const rm = target.closest('[data-off-remove]');
    if (rm) { readInputs(root); d.daysOff = d.daysOff.filter((_, i) => i !== Number(rm.dataset.offRemove)); return rerender(); }

    if (target.closest('[data-skip]')) {
      if (t.mode === 'first') { t.step = flow.indexOf('semester'); t.bubble = ''; return rerender(); }
      return finish();
    }
    if (target.closest('[data-back]')) {
      readInputs(root);
      t.step = Math.max(0, t.step - 1);
      t.bubble = '';
      return rerender();
    }
    if (target.closest('[data-next]')) {
      readInputs(root);
      const problem = validate(stepName);
      if (problem) { t.bubble = problem; toast(problem); return rerender(); }
      if (last) return finish();
      t.step += 1;
      t.bubble = '';
      window.scrollTo(0, 0);
      return rerender();
    }
  });
}

async function finish() {
  const d = t.draft;
  const mode = t.mode;
  t.mode = null;
  t.demo = null;

  if (mode === 'replay') { location.hash = '#/pond'; return; }

  const settings = {
    ...settingsFromDraft(d),
    weekStart: Number(d.weekStart),
    swipesTotal: Number(d.swipesTotal),
    pointsTotal: Number(d.pointsTotal),
    exchangeLimit: Number(d.exchangeLimit),
    guestTotal: Number(d.guestTotal) || 0,
    semesterName: String(d.semesterName).trim() || seasonName(d.start),
  };

  if (mode === 'semester') await startNewSemester(settings);
  else await saveSettings(settings);

  // Match my card → adjustment entries so balances equal what the card says.
  if (d.matchSwipes !== '' || d.matchPoints !== '') {
    const b = budget(settings, await getEntries(), todayKey());
    if (d.matchSwipes !== '') {
      const diff = Number(d.matchSwipes) - b.swipes.balance;
      if (diff) await addEntry({ type: 'adjust-swipes', amount: diff });
    }
    if (d.matchPoints !== '') {
      const diff = Math.round((Number(d.matchPoints) - b.points.balance) * 100) / 100;
      if (diff) await addEntry({ type: 'adjust-points', amount: diff });
    }
  }

  if (mode === 'first') {
    await saveProfile({ nickname: String(d.nickname).trim(), frogName: String(d.frogName).trim() || 'Pip', tutorialDone: true });
  } else {
    toast(`${settings.semesterName} started!`);
  }
  sessionStorage.setItem('pond:movein', '1');
  play('ribbit');
  location.hash = '#/pond';
}

