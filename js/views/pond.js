import { getSettings, getEntries, getFavorites, getProfile, saveProfile } from '../data/db.js';
import { budget } from '../core/calc.js';
import { todayKey, formatLong, formatShort, addDays, isDayOff } from '../core/dates.js';
import { reportStats, nextSemesterDefaults } from '../core/semester.js';
import { moodFor, reactionMood } from '../pip/mood.js';
import { pipLine, pick, PET } from '../pip/lines.js';
import { outfitFor } from '../pip/frog.js';
import { esc, money, count, plural } from '../ui/dom.js';
import { noteHTML, stampsHTML, pondSceneHTML } from '../ui/widgets.js';
import { reportHTML } from '../ui/report.js';
import { play } from '../ui/sound.js';
import { openFeedSheet, quickLog, describe } from './feed.js';
import { beginNewSemester } from './tutorial.js';
import { render } from '../router.js';
import { pingsNow, markPingsSeen, whoName, PINGS_EVENT, PING_KINDS } from '../data/social.js';
import { cloudEnabled, userNow } from '../data/supabase.js';

// One-time card nudging local-only users to make an account (for sync + friends + reminders).
function signinNudgeHTML(profile) {
  if (!cloudEnabled || userNow() || profile.signinNudgeSeen) return '';
  return `
  <section class="signin-nudge" aria-label="Make an account">
    <p class="hand">Want to sync to your computer, add pond friends, and get reminders?</p>
    <div class="signin-nudge__row">
      <a class="btn-sketch btn-sketch--go" href="#/login">Make a free account</a>
      <button type="button" class="btn-plain btn-plain--muted" data-nudge-dismiss>maybe later</button>
    </div>
  </section>`;
}

const PING_LINE = {
  snack: (who) => `${who} sent a snack! *nom nom* 🍪`,
  cheer: (who) => `${who} is cheering you on! 📣`,
  visit: (who) => `${who}’s frog hopped over to say hi! 🐸`,
  dance: (who) => `${who}’s frog is doing a silly dance! 💃`,
};

function pingsHTML() {
  const pings = pingsNow();
  if (!pings.length) return '';
  return `
  <section class="pings" aria-label="Messages from friends">
    ${pings.map((p) => `<p class="ping">${esc((PING_LINE[p.kind] ?? (() => 'A pond friend says hi!'))(whoName(p)))}</p>`).join('')}
    <button type="button" class="btn-plain" data-pings-ok>aw, thanks!</button>
  </section>`;
}

// Days in a row (before today) that ended on pace.
function streakDays(settings, entries, today) {
  let n = 0;
  let k = addDays(today, -1);
  for (let i = 0; i < 60 && k >= settings.start; i++, k = addDays(k, -1)) {
    if (k > settings.end || isDayOff(k, settings.daysOff ?? [])) continue;
    if (moodFor(budget(settings, entries, k)) === 'sad') break;
    n++;
  }
  return n;
}

function favRowHTML(favorites) {
  if (!favorites.length) {
    return '<div class="fav-row"><a class="fav-row__edit fav-row__edit--start" href="#/favorites">+ save a favorite order</a></div>';
  }
  return `
  <div class="fav-row">
    <span class="fav-row__label">favs:</span>
    ${favorites.slice(0, 4).map((f) => `<button type="button" class="fav fav--${f.type}" data-fav="${esc(f.id)}">${esc(f.name)} ${esc(describe(f.type, f.amount))}</button>`).join('')}
    <a class="fav-row__edit" href="#/favorites">edit</a>
  </div>`;
}

function recapHTML(settings, entries, b, profile) {
  if (settings.weeklyRecap === false || b.phase !== 'during') return '';
  if (profile.recapSeen === b.weekStart || b.weekStart <= settings.start) return '';
  const from = addDays(b.weekStart, -7);
  const to = addDays(b.weekStart, -1);
  let sw = 0, pt = 0, ex = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    if (e.type === 'swipe') sw += e.amount;
    if (e.type === 'points') pt += e.amount;
    if (e.type === 'exchange') ex += e.amount;
  }
  const last = budget(settings, entries, to);
  const onPace = last.points.leftWeek >= -0.004 && last.swipes.leftWeek >= 0;
  return `
  <section class="recap" aria-label="Last week’s recap">
    <p class="recap__title">Last week</p>
    <p class="recap__body">${sw + pt + ex === 0
      ? 'Nothing logged last week. If you ate on campus, add it from the Log tab!'
      : `${plural(sw, 'swipe')} · ${money(pt)} points · ${plural(ex, 'exchange')}. ${onPace ? 'Right on pace!' : 'A little over, but this week re-balanced.'}`}</p>
    <button type="button" class="btn-plain" data-recap-ok>got it</button>
  </section>`;
}

function finalsHTML(b) {
  if (!b.finals) return '';
  const extraPts = b.points.daily - b.points.planDaily;
  const extraSw = b.swipes.weekly - Math.round(b.swipes.planWeekly);
  const bits = [];
  if (b.points.total > 0 && extraPts > 0.5) bits.push(`${money(b.points.daily)} a day (${money(extraPts)} more than planned)`);
  if (b.swipes.total > 0 && extraSw > 0) bits.push(`${plural(b.swipes.weekly, 'swipe')} this week (${extraSw} extra)`);
  return `
  <section class="finals" aria-label="Finals mode">
    <p class="finals__title">Finals mode!</p>
    <p class="finals__body">${bits.length
      ? `You’ve got ${bits.join(' and ')}. Treat yourself, or a friend!`
      : 'Home stretch! You’re right on budget. Fuel up for exams.'}</p>
  </section>`;
}

function guestHTML(g) {
  if (!g.total) return '';
  return `
  <section class="guest">
    <span><b class="hand">Guest passes</b> <span class="muted">${Math.max(0, g.left)} of ${g.total} left</span></span>
    <button type="button" class="btn-sketch btn-sketch--small" data-feed="guest">+ guest</button>
  </section>`;
}

function phaseHTML(b, settings, name, stats, profile) {
  if (b.phase === 'before') {
    return `<section class="card"><p class="hand">Semester starts ${formatShort(settings.start)}. ${esc(name)} is napping until then.</p></section>`;
  }
  if (b.phase === 'after') {
    return `
    <section class="card">
      <p class="hand">The semester’s over! ${esc(name)} is resting.</p>
      <button type="button" class="btn-sketch btn-sketch--go" data-new-semester>Start next semester</button>
    </section>
    ${settings.reportCard !== false ? reportHTML(stats, { frogName: profile.frogName }) : ''}`;
  }
  return '';
}

const LEAVES = Array.from({ length: 10 }, (_, i) =>
  `<span class="leaf" style="--x:${(i * 37) % 100}%;--d:${(i % 5) * 0.18}s;--r:${(i * 53) % 360}deg" aria-hidden="true"></span>`).join('');

export async function renderPond(root) {
  const settings = await getSettings();
  if (!settings) { location.hash = '#/settings'; return; }

  const [entries, favorites, profile] = await Promise.all([getEntries(), getFavorites(), getProfile()]);
  const name = profile.frogName;
  const today = todayKey();
  const b = budget(settings, entries, today);
  const baseMood = moodFor(b);
  const mood = reactionMood() ?? baseMood;
  const streak = b.phase === 'during' ? streakDays(settings, entries, today) : 0;
  const movingIn = sessionStorage.getItem('pond:movein') === '1';
  if (movingIn) sessionStorage.removeItem('pond:movein');

  const line = movingIn
    ? `Welcome home${profile.nickname ? `, ${profile.nickname}` : ''}! This is our pond now.`
    : pipLine(mood, b, {
        seed: entries.length + Number(today.slice(-2)),
        nick: profile.nickname,
        streak,
        finals: b.finals,
      });
  const stats = b.phase === 'after' ? reportStats(settings, entries) : null;

  // Friend pings can bring a visiting frog or a dance to the pond.
  const pings = pingsNow();
  const visit = [...pings].reverse().find((p) => p.kind === 'visit');
  const visitor = visit ? { mood: visit.mood ?? 'happy', name: visit.frog_name || 'Pip' } : null;
  const dancing = pings.some((p) => p.kind === 'dance');

  root.innerHTML = `
  <div class="pond-page">
    <header class="pond-page__head">
      <p class="eyebrow">${esc(settings.semesterName)} · ${b.daysLeft} eating ${b.daysLeft === 1 ? 'day' : 'days'} left${streak >= 3 ? ` · <span class="streak">${streak}-day streak</span>` : ''}</p>
      <h1 class="page-title">${formatLong(today)}</h1>
    </header>

    <div class="pond-page__a">
      <section aria-label="${esc(name)}" class="pond-wrap">
        ${pondSceneHTML({ mood, name, outfit: outfitFor(today), button: true, extraClass: movingIn ? 'is-moving-in' : '', dancing, visitor })}
        ${movingIn ? `<div class="leaves" aria-hidden="true">${LEAVES}</div>` : ''}
        <p class="pip-says" aria-live="polite">“${esc(line)}”</p>
      </section>
      ${pingsHTML()}
      ${signinNudgeHTML(profile)}
      ${recapHTML(settings, entries, b, profile)}
      ${finalsHTML(b)}
      ${phaseHTML(b, settings, name, stats, profile)}
    </div>

    <div class="pond-page__b">
      <div class="notes">
        ${noteHTML('swipes', 'Swipes', b.swipes, count)}
        ${noteHTML('points', 'Points', b.points, money)}
      </div>

      ${stampsHTML(b.exchanges, b.weekResets)}
      ${guestHTML(b.guests)}

      <section aria-label="Feed ${esc(name)}" data-feed-area>
        <p class="feed__title">Feed ${esc(name)}:</p>
        <div class="feed-row">
          <button type="button" class="btn-sketch btn-sketch--swipe" data-feed="swipe">a swipe</button>
          <button type="button" class="btn-sketch btn-sketch--points" data-feed="points">points</button>
          <button type="button" class="btn-sketch btn-sketch--exchange" data-feed="exchange"${b.exchanges.allowedToday ? '' : ' disabled aria-describedby="ex-note"'}>exchange</button>
        </div>
        ${favRowHTML(favorites)}
      </section>
    </div>
  </div>`;

  const page = root.querySelector('.pond-page');
  const says = root.querySelector('.pip-says');
  let pets = 0;

  page.addEventListener('click', async (e) => {
    const feed = e.target.closest('[data-feed]');
    if (feed) {
      if (feed.dataset.feed === 'points') return openFeedSheet({ type: 'points' });
      return quickLog({ type: feed.dataset.feed, amount: 1 });
    }
    const chip = e.target.closest('[data-fav]');
    if (chip) {
      const f = favorites.find((x) => x.id === chip.dataset.fav);
      if (f) quickLog({ type: f.type, amount: f.amount, label: `${f.name} (${describe(f.type, f.amount)})` });
      return;
    }
    const frog = e.target.closest('[data-pet]');
    if (frog) {
      pets += 1;
      frog.classList.remove('is-petted');
      void frog.offsetWidth; // restart the hop animation
      frog.classList.add('is-petted');
      frog.insertAdjacentHTML('beforeend', '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z"/></svg>');
      setTimeout(() => frog.querySelector('.heart')?.remove(), 900);
      says.textContent = `“${pick(PET, pets + Date.now() % 7, profile.nickname)}”`;
      play('ribbit');
      return;
    }
    if (e.target.closest('[data-recap-ok]')) return saveProfile({ recapSeen: b.weekStart });
    if (e.target.closest('[data-pings-ok]')) { play('pop'); return markPingsSeen(pingsNow().map((p) => p.id)); }
    if (e.target.closest('[data-nudge-dismiss]')) return saveProfile({ signinNudgeSeen: true });
    if (e.target.closest('[data-new-semester]')) return beginNewSemester(nextSemesterDefaults(settings, entries));
  });

  // Re-render the pond when friend pings arrive (while it's the open page).
  if (!renderPond._pingWired) {
    renderPond._pingWired = true;
    window.addEventListener(PINGS_EVENT, () => { if (location.hash === '#/pond') render(); });
  }
}
