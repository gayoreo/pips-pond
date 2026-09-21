import { getProfile, saveProfile, getSettings } from '../data/db.js';
import { frogSVG } from '../pip/frog.js';
import { esc } from '../ui/dom.js';

let step = 0;

const isInstalled = () =>
  window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const MOODS = [
  ['happy', 'Happy', 'You’re within your budget.'],
  ['worried', 'Worried', 'Getting close to today’s points budget.'],
  ['sad', 'Sad', 'You went over. Tomorrow re-balances, so I’ll bounce back.'],
  ['sleeping', 'Napping', 'A day off, or outside the semester.'],
];

function installHTML() {
  if (isInstalled()) return '<p>You’re all set. I’m already on your home screen!</p>';
  if (isIOS()) {
    return `
      <ol class="t-list">
        <li>Open this page in <b>Safari</b>.</li>
        <li>Tap the <b>Share</b> button (the square with an arrow).</li>
        <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        <li>Open me from the new icon. I work offline, too.</li>
      </ol>
      <p class="card__hint">The home-screen app keeps its own data, so do your setup from the icon.</p>`;
  }
  return `
    <p>On your phone, open this page and add it to your home screen. In Safari: <b>Share → Add to Home Screen</b>. In Chrome: <b>⋮ menu → Add to Home screen</b>.</p>
    <p>On a computer, Chrome and Edge show an <b>Install</b> icon in the address bar.</p>`;
}

function steps(profile, hasSettings) {
  const name = esc(profile.frogName || 'Pip');
  const nick = esc(profile.nickname);
  return [
    {
      mood: 'happy',
      title: `Hi! I’m ${name}.`,
      body: `
        <p>I live on your meal plan. Every time you eat on campus, you feed me, and I keep an eye on your budget so it lasts the whole semester.</p>
        <label class="field">What should I call you?<input id="t-nick" maxlength="24" autocomplete="nickname" value="${nick}"></label>
        <label class="field">What’s my name?<input id="t-frog" maxlength="24" autocomplete="off" value="${name}"></label>`,
    },
    {
      mood: 'eating',
      title: 'Feed me when you eat',
      body: `
        <p>On the Pond page, tap <b>a swipe</b>, <b>points</b>, or <b>exchange</b>. Points open a keypad so you can type what you spent.</p>
        <p>Save your usual orders as <b>favorites</b> to log them in one tap.</p>
        <p>Made a mistake? Fix or delete any entry from the <b>Log</b> tab.</p>`,
    },
    {
      mood: 'happy',
      title: 'How your budget works',
      body: `
        <ul class="t-list">
          <li><b class="t-swipe">Swipes</b> are a weekly pool. Today shows what’s left for the week.</li>
          <li><b class="t-points">Points</b> get a daily amount that re-balances every day. Spend less today and you get more tomorrow.</li>
          <li><b class="t-plum">Exchanges</b> have a weekly limit and only work on the days you pick.</li>
        </ul>`,
    },
    {
      mood: null,
      title: 'I’ll show you how it’s going',
      body: `
        <div class="t-moods">
          ${MOODS.map(([m, label, text]) => `
            <div class="t-mood">
              <div class="mini-frog">${frogSVG(m, profile.frogName)}</div>
              <div><span class="hand t-mood__label">${label}</span><p class="card__hint">${text}</p></div>
            </div>`).join('')}
        </div>`,
    },
    {
      mood: 'sleeping',
      title: 'Days off',
      body: `
        <p>Add breaks and holidays in Settings so your budget skips them. I nap on those days.</p>
        <p>Starting partway through the semester? Use <b>Match my card</b> in Settings to line up with your real balance.</p>`,
    },
    { mood: 'happy', title: 'Put me on your home screen', body: installHTML() },
    hasSettings
      ? { mood: 'happy', title: `That’s everything${nick ? `, ${nick}` : ''}!`, body: '<p>Let’s get back to the pond.</p>' }
      : {
          mood: 'happy',
          title: `Ready${nick ? `, ${nick}` : ''}?`,
          body: '<p>Next you’ll set up your semester. Have your meal plan handy: your swipes, your points, and your semester dates. Your school’s dining site or app lists them.</p>',
        },
  ];
}

async function finish(hasSettings) {
  step = 0;
  await saveProfile({ tutorialDone: true });
  location.hash = hasSettings ? '#/pond' : '#/settings';
}

export async function renderTutorial(root) {
  const profile = await getProfile();
  const hasSettings = Boolean(await getSettings());
  const all = steps(profile, hasSettings);
  step = Math.min(step, all.length - 1);
  const s = all[step];
  const last = step === all.length - 1;

  root.innerHTML = `
    <div class="tutorial">
      <div class="tutorial__top">
        <span class="eyebrow">${step + 1} of ${all.length}</span>
        ${last ? '' : '<button type="button" class="btn-plain btn-plain--muted" data-skip>skip</button>'}
      </div>
      ${s.mood ? `
      <div class="pond" aria-hidden="true">
        <span class="pad pad--a"></span><span class="pad pad--b"></span>
        <span class="ripple ripple--a"></span><span class="ripple ripple--b"></span>
        <div class="frog is-${s.mood}">${frogSVG(s.mood, profile.frogName)}</div>
      </div>` : ''}
      <h1 class="page-title" tabindex="-1">${s.title}</h1>
      <div class="tutorial__body stack">${s.body}</div>
      <div class="tutorial__dots" aria-hidden="true">
        ${all.map((_, i) => `<span class="${i === step ? 'is-on' : ''}"></span>`).join('')}
      </div>
      <div class="tutorial__nav">
        <button type="button" class="btn-sketch" data-back${step === 0 ? ' disabled' : ''}>back</button>
        <button type="button" class="btn-sketch btn-sketch--go" data-next>${last ? (hasSettings ? 'Back to the pond' : 'Set up my semester') : 'next'}</button>
      </div>
    </div>`;

  root.querySelector('h1').focus();

  root.querySelector('.tutorial').addEventListener('click', async (e) => {
    if (e.target.closest('[data-skip]')) return finish(hasSettings);
    if (e.target.closest('[data-back]')) { step = Math.max(0, step - 1); return renderTutorial(root); }
    if (e.target.closest('[data-next]')) {
      if (step === 0) {
        await saveProfile({
          nickname: root.querySelector('#t-nick').value.trim(),
          frogName: root.querySelector('#t-frog').value.trim() || 'Pip',
        });
      }
      if (last) return finish(hasSettings);
      step += 1;
      return renderTutorial(root);
    }
  });
}