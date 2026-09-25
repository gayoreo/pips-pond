// Pond friends: your friend code + invite link, requests, who's free right now, the friends list with
// ping buttons, and a sheet for each friend (their week, free time together, study invites, what they can see).
import { userNow, myProfile, appUrl, pendingInvite, clearPendingInvite } from '../data/auth.js';
import {
  refreshFriends, friendsNow, sendFriendRequest, respondToRequest, removeFriend, sendPing,
  PING_KINDS, whoName, FRIENDS_EVENT, refreshSchedules, scheduleOf,
} from '../data/social.js';
import { getProfile, saveProfile } from '../data/db.js';
import {
  getStudy, dayItems, freeGaps, sharedOn, nowFor, timeRange, studyHours, shareRulesOf, SHARE_CATS,
} from '../data/study.js';
import { openSheet } from '../ui/sheet.js';
import { cachedDining, statusAt } from '../data/dining.js';
import { frogSVG } from '../pip/frog.js';
import { MOOD_LABEL } from '../pip/mood.js';
import { formatShort, ago, todayKey, addDays, fromKey, formatHM, hmOf } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';

const REQUEST_REPLY = {
  sent: 'Request sent! They’ll see it next time they open their pond.',
  accepted: 'You’re pond friends now! 🐸',
  already: 'You’re already friends.',
  pending: 'You already have a request out to them.',
  not_found: 'No one found with that username or code.',
  self: 'That’s you! Share your code with a friend instead.',
};

const PING_EMOJI = { snack: '🍪', cheer: '📣', visit: '🐸', dance: '💃' };
const KIND_WORD = { lab: 'lab', exam: 'exam', study: 'study time', work: 'work', appointment: 'appointment', other: '' };

// ---------- shared schedules ----------
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#E3DAC4');
const nowHM = () => hmOf(new Date().toISOString());
const dayName = (d, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fromKey(d).toLocaleDateString(undefined, { weekday: 'short' }));

function nowInfo(sched) {
  const items = sharedOn(sched, todayKey());
  if (!items.length) return { busy: false, text: 'Nothing on their schedule today' };
  const n = nowFor(items, nowHM());
  if (n.busy) return { busy: true, text: `In ${n.item.code || n.item.name} until ${formatHM(n.until)}` };
  return { busy: false, text: n.until ? `Free until ${formatHM(n.until)}` : 'Done for the day' };
}

// Times you're both free on a day, using your own classes and calendar and what they share.
function bothFree(sched, day, hours) {
  let gaps = freeGaps([...dayItems(getStudy(), day), ...sharedOn(sched, day)], hours);
  if (day === todayKey()) {
    const now = nowHM();
    gaps = gaps.filter((g) => g.end > now).map((g) => (g.start < now ? { ...g, start: now } : g)).filter((g) => g.end > g.start);
  }
  return gaps;
}

function dayHTML(f, sched, day, hours) {
  const theirs = sharedOn(sched, day);
  const both = bothFree(sched, day, hours);
  const name = esc(f.nickname || f.username || 'Their');
  return `
    <p class="fw-sub">${name}’s day</p>
    ${theirs.length
      ? `<ul class="fw-list">${theirs.map((i) => `
          <li style="--course:${i.color ? safeColor(i.color) : `var(--kind-${i.kind})`}">
            <span class="fw-time">${esc(timeRange(i))}</span>
            <span>${i.kind === 'exam' ? '📝 ' : ''}${esc(i.name)}${KIND_WORD[i.kind] && i.kind !== 'exam' ? ` <span class="muted">${KIND_WORD[i.kind]}</span>` : ''}${i.place ? ` <span class="muted">· ${esc(i.place)}</span>` : ''}</span>
          </li>`).join('')}</ul>`
      : '<p class="card__hint">Nothing they shared for this day.</p>'}
    <p class="fw-sub">Free at the same time</p>
    ${both.length
      ? `<ul class="fw-free">${both.map((g) => `<li>🐸 ${formatHM(g.start)} to ${formatHM(g.end)}</li>`).join('')}</ul>`
      : `<p class="card__hint">No free hour together between ${formatHM(hours.from)} and ${formatHM(hours.to)}.</p>`}`;
}

// Up to 3 upcoming times you're both free and somewhere is open, for a meal invite.
function mealSlots(sched, hours) {
  const places = cachedDining()?.places ?? [];
  if (!places.length) return [];
  const today = todayKey();
  const out = [];
  for (let i = 0; i < 3 && out.length < 3; i++) {
    const day = addDays(today, i);
    for (const g of bothFree(sched, day, hours)) {
      if (out.length >= 3) break;
      const open = places.filter((pl) => statusAt(pl, day, g.start).open && pl.menuId);
      if (!open.length) continue;
      const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `on ${fromKey(day).toLocaleDateString(undefined, { weekday: 'long' })}`;
      out.push(`${when} at ${formatHM(g.start)}, ${open[0].name}`);
    }
  }
  return out;
}

// Up to 4 upcoming times you're both free, for a study invite.
function studySlots(sched, hours) {
  const today = todayKey();
  const out = [];
  for (let i = 0; i < 7 && out.length < 4; i++) {
    const day = addDays(today, i);
    for (const g of bothFree(sched, day, hours)) {
      if (out.length >= 4) break;
      out.push(`${i === 0 ? 'today' : i === 1 ? 'tomorrow' : `on ${fromKey(day).toLocaleDateString(undefined, { weekday: 'long' })}`} at ${formatHM(g.start)}`);
    }
  }
  return out;
}

// ---------- what a friend can see ----------
function shareToggles(values, attr) {
  return Object.entries(SHARE_CATS).map(([k, label]) =>
    `<label class="row"><span>${label}</span><input type="checkbox" class="switch" ${attr}="${k}"${values[k] ? ' checked' : ''}></label>`).join('');
}

async function saveRules(mutate) {
  const me = await getProfile();
  const rules = shareRulesOf(me);
  mutate(rules);
  await saveProfile({ shareRules: rules });
}

// ---------- one friend's sheet ----------
async function openFriendSheet(f, rerender) {
  const me = await getProfile();
  const hours = studyHours(me);
  const rules = shareRulesOf(me);
  const custom = Boolean(rules.people[f.id]);
  const theirs = rules.people[f.id] ?? rules.all;
  const sched = scheduleOf(f.id);
  const mood = f.mood ?? 'sleeping';
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const now = sched ? nowInfo(sched) : null;
  const slots = sched ? studySlots(sched, hours) : [];
  const meals = sched ? mealSlots(sched, hours) : [];

  const html = `
    <div class="fs-head">
      <span class="friend__frog fs-frog is-${mood}">${frogSVG(mood, f.frog_name || 'Pip', { companion: f.companion || 'frog' })}</span>
      <div>
        <p class="hand fs-name">${esc(whoName(f))}</p>
        <p class="muted">${f.username ? `@${esc(f.username)} · ` : ''}${esc(f.frog_name || 'Pip')} is ${esc((MOOD_LABEL[mood] ?? mood).toLowerCase())}${f.mood_at ? `, as of ${esc(ago(f.mood_at))}` : ''}</p>
        ${now ? `<p class="friend__now${now.busy ? ' is-busy' : ' is-free'}">${now.busy ? '📚' : '🟢'} ${esc(now.text)}</p>` : ''}
      </div>
    </div>

    <div class="fs-pings">
      ${Object.entries(PING_KINDS).map(([k, v]) => `<button type="button" class="btn-sketch btn-sketch--small" data-fping="${k}">${PING_EMOJI[k]} ${esc(v.verb)}</button>`).join('')}
    </div>

    <section class="fs-section">
      <p class="fw-sub">📖 Study together?</p>
      ${slots.length ? `<div class="chip-row">${slots.map((sl) => `<button type="button" class="fw-day" data-slot="${esc(sl)}">${esc(sl)}</button>`).join('')}</div>` : ''}
      <div class="row">
        <label class="field grow"><span class="field__label">When <span class="muted">(optional)</span></span><input name="studyNote" maxlength="40" autocomplete="off" placeholder="${slots.length ? 'tap a time above or type one' : 'after lunch, 3 PM…'}"></label>
        <button type="button" class="btn-sketch btn-sketch--small btn-sketch--go" data-invite>ask</button>
      </div>
    </section>

    <section class="fs-section">
      <p class="fw-sub">🍽 Grab a meal?</p>
      ${meals.length ? `<div class="chip-row">${meals.map((sl) => `<button type="button" class="fw-day" data-mealslot="${esc(sl)}">${esc(sl)}</button>`).join('')}</div>` : ''}
      <div class="row">
        <label class="field grow"><span class="field__label">When <span class="muted">(optional)</span></span><input name="mealNote" maxlength="40" autocomplete="off" placeholder="${meals.length ? 'tap a time above or type one' : 'lunch at Central, 12:30…'}"></label>
        <button type="button" class="btn-sketch btn-sketch--small btn-sketch--go" data-meal-invite>ask</button>
      </div>
    </section>

    ${sched ? `
    <section class="fs-section">
      <p class="fw-sub">Their week</p>
      <div class="chip-row fw-days">${days.map((d, i) =>
        `<button type="button" class="fw-day" data-day="${d}" aria-pressed="${i === 0}">${dayName(d, i)}</button>`).join('')}</div>
      <div class="fw-body">${dayHTML(f, sched, today, hours)}</div>
      <p class="card__hint">Free times use their shared schedule plus your own classes and calendar. They might have other plans, so check with them.</p>
    </section>` : '<p class="card__hint">They haven’t shared their schedule with you.</p>'}

    <section class="fs-section">
      <p class="fw-sub">What they can see of your schedule</p>
      ${me.shareSchedule ? `
        <div class="seg seg--2" role="group" aria-label="What they see">
          <button type="button" data-custom="0" aria-pressed="${!custom}">Same as everyone</button>
          <button type="button" data-custom="1" aria-pressed="${custom}">Just for them</button>
        </div>
        <div class="stack" data-person${custom ? '' : ' hidden'}>${shareToggles(theirs, 'data-pshare')}</div>`
      : '<p class="card__hint">Turn on schedule sharing on the Friends page first.</p>'}
    </section>

    <button type="button" class="btn-plain btn-plain--danger" data-unfriend>remove friend</button>`;

  openSheet(whoName(f), html, (sheet, close) => {
    const q = (sel) => sheet.querySelector(sel);
    sheet.addEventListener('change', async (e) => {
      const k = e.target.dataset.pshare;
      if (!k) return;
      await saveRules((r) => { r.people[f.id] = { ...(r.people[f.id] ?? r.all), [k]: e.target.checked }; });
    });
    sheet.addEventListener('click', async (e) => {
      const t = e.target;
      const day = t.closest('[data-day]');
      if (day) {
        sheet.querySelectorAll('[data-day]').forEach((x) => x.setAttribute('aria-pressed', String(x === day)));
        q('.fw-body').innerHTML = dayHTML(f, sched, day.dataset.day, hours);
        return;
      }
      const slot = t.closest('[data-slot]');
      if (slot) { q('[name="studyNote"]').value = slot.dataset.slot; return; }
      const mslot = t.closest('[data-mealslot]');
      if (mslot) { q('[name="mealNote"]').value = mslot.dataset.mealslot; return; }
      if (t.closest('[data-meal-invite]')) {
        const btn = t.closest('[data-meal-invite]');
        btn.disabled = true;
        try {
          await sendPing(f.id, 'meal', q('[name="mealNote"]').value.trim() || null);
          play('pop');
          toast('Meal invite sent!');
          q('[name="mealNote"]').value = '';
        } catch (er) { toast(er.message); }
        finally { btn.disabled = false; }
        return;
      }
      if (t.closest('[data-invite]')) {
        const btn = t.closest('[data-invite]');
        btn.disabled = true;
        try {
          await sendPing(f.id, 'study', q('[name="studyNote"]').value.trim() || null);
          play('pop');
          toast('Study invite sent!');
          q('[name="studyNote"]').value = '';
        } catch (er) { toast(er.message); }
        finally { btn.disabled = false; }
        return;
      }
      const fping = t.closest('[data-fping]');
      if (fping) {
        fping.disabled = true;
        try {
          await sendPing(f.id, fping.dataset.fping);
          play('pop');
          toast(`${PING_KINDS[fping.dataset.fping].label} sent!`);
        } catch (er) { toast(er.message); }
        finally { setTimeout(() => { fping.disabled = false; }, 500); }
        return;
      }
      const mode = t.closest('[data-custom]');
      if (mode) {
        const on = mode.dataset.custom === '1';
        sheet.querySelectorAll('[data-custom]').forEach((x) => x.setAttribute('aria-pressed', String(x === mode)));
        q('[data-person]').hidden = !on;
        await saveRules((r) => { if (on) r.people[f.id] = { ...(r.people[f.id] ?? r.all) }; else delete r.people[f.id]; });
        if (on) {
          const cur = shareRulesOf(await getProfile()).people[f.id];
          q('[data-person]').innerHTML = shareToggles(cur, 'data-pshare');
        }
        return;
      }
      if (t.closest('[data-unfriend]')) {
        if (!confirm(`Remove ${whoName(f)} as a pond friend?`)) return;
        await removeFriend(f.id);
        await saveRules((r) => { delete r.people[f.id]; });
        close();
        toast('Friend removed.');
        rerender();
      }
    });
  });
}

// ---------- list pieces ----------
function friendCard(f) {
  const mood = f.mood ?? 'sleeping';
  const sched = scheduleOf(f.id);
  const now = sched ? nowInfo(sched) : null;
  return `
  <li class="friend">
    <button type="button" class="friend__open" data-friend="${esc(f.id)}" aria-label="Open ${esc(whoName(f))}">
      <span class="friend__frog is-${mood}">${frogSVG(mood, f.frog_name || 'Pip', { companion: f.companion || 'frog' })}</span>
      <span class="friend__who">
        <b class="hand">${esc(whoName(f))}</b>
        <span class="muted">${esc(f.frog_name || 'Pip')} · ${MOOD_LABEL[mood] ?? mood}</span>
        ${f.mood_at ? `<span class="friend__stamp">as of ${esc(ago(f.mood_at))}</span>` : ''}
        ${now ? `<span class="friend__now">${now.busy ? '📚' : '🟢'} ${esc(now.text)}</span>` : ''}
      </span>
    </button>
    <div class="friend__acts">
      ${Object.entries(PING_KINDS).map(([k, v]) =>
        `<button type="button" class="ping-btn" data-ping="${k}" data-id="${esc(f.id)}" title="${v.verb}" aria-label="${v.verb}: ${esc(whoName(f))}">${PING_EMOJI[k]}</button>`).join('')}
    </div>
  </li>`;
}

function freeNowHTML(friends) {
  const withSched = friends.filter((f) => scheduleOf(f.id));
  if (!withSched.length) return '';
  const rows = withSched.map((f) => ({ f, n: nowInfo(scheduleOf(f.id)) })).sort((a, b) => Number(a.n.busy) - Number(b.n.busy));
  return `
    <section class="card">
      <h2 class="card__title">Right now</h2>
      <ul class="free-now">${rows.map(({ f, n }) => `
        <li><button type="button" data-friend="${esc(f.id)}">
          <b>${esc(whoName(f))}</b> <span class="${n.busy ? 'muted' : 'is-free'}">${n.busy ? '📚' : '🟢'} ${esc(n.text)}</span>
        </button></li>`).join('')}</ul>
    </section>`;
}

function requestCard(f) {
  if (f.status === 'incoming') {
    return `
    <li class="req">
      <span>🐸 <b class="hand">${esc(whoName(f))}</b> wants to be pond friends</span>
      <div class="row">
        <button type="button" class="btn-sketch btn-sketch--small btn-sketch--go" data-accept="${esc(f.id)}">accept</button>
        <button type="button" class="btn-plain btn-plain--muted" data-decline="${esc(f.id)}">decline</button>
      </div>
    </li>`;
  }
  return `
  <li class="req req--out">
    <span>Waiting for <b class="hand">${esc(whoName(f))}</b>${f.since ? ` · since ${formatShort(String(f.since).slice(0, 10))}` : ''}</span>
    <button type="button" class="btn-plain btn-plain--muted" data-cancel="${esc(f.id)}">cancel</button>
  </li>`;
}

export async function renderFriends(root) {
  if (!userNow()) { toast('Sign in to add pond friends.'); location.hash = '#/settings'; return; }
  const profile = await myProfile().catch(() => null);
  const code = profile?.friend_code ?? '······';
  const invite = `${appUrl()}?add=${code}`;
  const list = friendsNow();
  const friends = list.filter((f) => f.status === 'friend');
  const incoming = list.filter((f) => f.status === 'incoming');
  const outgoing = list.filter((f) => f.status === 'outgoing');
  const me = await getProfile();
  const rules = shareRulesOf(me);
  const customCount = Object.keys(rules.people).filter((id) => friends.some((f) => f.id === id)).length;
  const hasSchedule = getStudy().courses.some((c) => c.meetings?.length) || getStudy().blocks.length > 0;
  const prefill = pendingInvite();
  if (prefill) clearPendingInvite();

  root.innerHTML = `
  <div class="friends-page stack">
    <div class="sheet__head">
      <a class="btn-plain btn-plain--muted" href="#/settings">back</a>
      <h1 class="page-title">Pond friends</h1>
      <span class="spacer"></span>
    </div>

    ${freeNowHTML(friends)}

    ${incoming.length ? `<section class="card"><h2 class="card__title">Friend requests</h2><ul class="reqs">${incoming.map(requestCard).join('')}</ul></section>` : ''}

    <section class="card">
      <h2 class="card__title">Your pond friends ${friends.length ? `<span class="muted">(${friends.length})</span>` : ''}</h2>
      ${friends.length
        ? `<ul class="friends">${friends.map(friendCard).join('')}</ul>
           <p class="card__hint">Tap a friend to see their week, find time to study together, or choose what they can see.</p>`
        : '<p class="card__hint">No friends yet. Share your code or invite link below!</p>'}
    </section>

    <section class="card">
      <h2 class="card__title">Add a friend</h2>
      <form id="add-form" class="row" novalidate>
        <label class="field grow">Username or friend code<input name="target" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(prefill ?? '')}" placeholder="@sam_frog or A1B2C3"></label>
        <button type="submit" class="btn-sketch">add</button>
      </form>
      <p class="card__hint">Your friend code: <code class="shortcut__url">${esc(code)}</code>
        <button type="button" class="btn-plain" data-copy="${esc(code)}">copy</button></p>
      <div class="row">
        <button type="button" class="btn-plain" data-copy="${esc(invite)}">copy invite link</button>
        <button type="button" class="btn-plain" data-share="${esc(invite)}">share…</button>
      </div>
      <p class="form-error" role="alert"></p>
    </section>

    <section class="card">
      <h2 class="card__title">Sharing your schedule</h2>
      <label class="row"><span>Share my schedule with friends</span><input type="checkbox" class="switch" id="share-schedule"${me.shareSchedule ? ' checked' : ''}></label>
      <div class="stack" data-share-opts${me.shareSchedule ? '' : ' hidden'}>
        <p class="card__hint">What every friend sees:</p>
        ${shareToggles(rules.all, 'data-ashare')}
        <p class="card__hint">${customCount ? `${customCount} ${customCount === 1 ? 'friend has' : 'friends have'} their own settings. ` : ''}To change what one friend sees, tap them in your list.</p>
      </div>
      ${hasSchedule ? '' : '<p class="card__hint">Add class times or blocks in Study first, then friends can see when you’re free.</p>'}
      <p class="card__hint">Friends always see your frog’s name and mood. Homework is never shared.</p>
    </section>

    ${outgoing.length ? `<section class="card"><h2 class="card__title">Sent requests</h2><ul class="reqs">${outgoing.map(requestCard).join('')}</ul></section>` : ''}
  </div>`;

  const err = (m) => { root.querySelector('.form-error').textContent = m; };
  const rerender = () => renderFriends(root);

  root.querySelector('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('');
    const target = e.target.target.value.trim();
    if (!target) return err('Type a username or friend code.');
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const status = await sendFriendRequest(target);
      toast(REQUEST_REPLY[status] ?? 'Done.');
      if (['sent', 'accepted'].includes(status)) { play('ribbit'); e.target.target.value = ''; }
      else if (['not_found', 'self'].includes(status)) err(REQUEST_REPLY[status]);
    } catch (er) {
      err(er.message);
    } finally {
      button.disabled = false;
    }
  });

  root.querySelector('.friends-page').addEventListener('change', async (e) => {
    if (e.target.id === 'share-schedule') {
      await saveProfile({ shareSchedule: e.target.checked });
      root.querySelector('[data-share-opts]').hidden = !e.target.checked;
      toast(e.target.checked ? 'Friends can see your schedule now.' : 'Your schedule is private again.');
      return;
    }
    const k = e.target.dataset.ashare;
    if (k) await saveRules((r) => { r.all[k] = e.target.checked; });
  });

  root.querySelector('.friends-page').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-friend]');
    if (open) { const f = friendsNow().find((x) => x.id === open.dataset.friend); if (f) openFriendSheet(f, rerender); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied!'); }
      catch { toast('Couldn’t copy. Press and hold to copy it.'); }
      return;
    }
    const share = e.target.closest('[data-share]');
    if (share) {
      const url = share.dataset.share;
      if (navigator.share) { try { await navigator.share({ title: 'Join me on Pip’s Pond', url }); } catch { /* cancelled */ } }
      else { try { await navigator.clipboard.writeText(url); toast('Link copied!'); } catch { toast(url); } }
      return;
    }
    const ping = e.target.closest('[data-ping]');
    if (ping) {
      ping.disabled = true;
      ping.classList.remove('is-sent');
      void ping.offsetWidth; // restart the pop animation
      ping.classList.add('is-sent');
      try {
        await sendPing(ping.dataset.id, ping.dataset.ping);
        play('pop');
        toast(`${PING_KINDS[ping.dataset.ping].label} sent!`);
      } catch (er) { toast(er.message); ping.classList.remove('is-sent'); }
      finally { setTimeout(() => { ping.disabled = false; }, 500); }
      return;
    }
    const accept = e.target.closest('[data-accept]');
    if (accept) { await respondToRequest(accept.dataset.accept, true); play('ribbit'); toast('You’re pond friends now! 🐸'); return rerender(); }
    const decline = e.target.closest('[data-decline]');
    if (decline) { await respondToRequest(decline.dataset.decline, false); return rerender(); }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) { await removeFriend(cancel.dataset.cancel); toast('Request cancelled.'); return rerender(); }
  });

  // Re-render when friends/requests change (from a background sync), but only while this page is open
  // and no friend sheet is open on top of it.
  const onChange = () => {
    if (location.hash !== '#/friends') return;
    if (document.body.classList.contains('sheet-open')) { window.addEventListener(FRIENDS_EVENT, onChange, { once: true }); return; }
    renderFriends(root);
  };
  window.removeEventListener(FRIENDS_EVENT, root._friendsListener ?? (() => {}));
  root._friendsListener = onChange;
  window.addEventListener(FRIENDS_EVENT, onChange, { once: true });

  refreshFriends().catch(() => { /* offline: shows the last-known list */ });
  refreshSchedules().catch(() => { /* not set up yet or offline */ });
}
