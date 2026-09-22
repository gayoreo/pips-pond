// Pond friends: your friend code + invite link, requests, and the friends list with ping buttons.
import { userNow, myProfile, appUrl, pendingInvite, clearPendingInvite } from '../data/auth.js';
import {
  refreshFriends, friendsNow, sendFriendRequest, respondToRequest, removeFriend, sendPing,
  PING_KINDS, whoName, FRIENDS_EVENT, refreshSchedules, scheduleOf,
} from '../data/social.js';
import { getProfile, saveProfile } from '../data/db.js';
import { getStudy, dayItems, freeGaps, sharedOn, nowFor, timeRange } from '../data/study.js';
import { openSheet } from '../ui/sheet.js';
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

function friendCard(f) {
  const mood = f.mood ?? 'sleeping';
  return `
  <li class="friend">
    <span class="friend__frog is-${mood}">${frogSVG(mood, f.frog_name || 'Pip')}</span>
    <div class="friend__who">
      <b class="hand">${esc(whoName(f))}</b>
      <span class="muted">${esc(f.frog_name || 'Pip')} · ${MOOD_LABEL[mood] ?? mood}</span>
      ${f.mood_at ? `<span class="friend__stamp">as of ${esc(ago(f.mood_at))}</span>` : ''}
      ${scheduleOf(f.id) ? `<span class="friend__now">📚 ${esc(nowLine(scheduleOf(f.id)))}</span>` : ''}
    </div>
    <div class="friend__acts">
      ${Object.entries(PING_KINDS).map(([k, v]) =>
        `<button type="button" class="ping-btn" data-ping="${k}" data-id="${esc(f.id)}" title="${v.verb}" aria-label="${v.verb}: ${esc(whoName(f))}">${PING_EMOJI[k]}</button>`).join('')}
      ${scheduleOf(f.id) ? `<button type="button" class="ping-btn" data-week="${esc(f.id)}" title="Their week" aria-label="See ${esc(whoName(f))}’s week">📅</button>` : ''}
      <button type="button" class="btn-plain btn-plain--muted" data-remove="${esc(f.id)}" aria-label="Remove ${esc(whoName(f))}">✕</button>
    </div>
  </li>`;
}

// ---------- shared class schedules ----------
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#E3DAC4');
const nowHM = () => hmOf(new Date().toISOString());

function nowLine(sched) {
  const items = sharedOn(sched, todayKey());
  if (!items.length) return 'No classes today';
  const n = nowFor(items, nowHM());
  if (n.busy) return `In ${n.item.code || n.item.name} until ${formatHM(n.until)}`;
  return n.until ? `Free until ${formatHM(n.until)}` : 'Done with classes today';
}

function dayHTML(f, sched, day) {
  const theirs = sharedOn(sched, day);
  let both = freeGaps([...dayItems(getStudy(), day), ...theirs]);
  if (day === todayKey()) { const now = nowHM(); both = both.filter((g) => g.end > now); }
  const name = esc(f.nickname || f.username || 'Their');
  return `
    <p class="fw-sub">${name}’s classes</p>
    ${theirs.length
      ? `<ul class="fw-list">${theirs.map((i) => `
          <li style="--course:${safeColor(i.color)}">
            <span class="fw-time">${esc(timeRange(i))}</span>
            <span>${esc(i.name)}${i.kind === 'lab' ? ' <span class="muted">lab</span>' : ''}</span>
          </li>`).join('')}</ul>`
      : '<p class="card__hint">No classes this day.</p>'}
    <p class="fw-sub">Free at the same time</p>
    ${both.length
      ? `<ul class="fw-free">${both.map((g) => `<li>🐸 ${formatHM(g.start)} to ${formatHM(g.end)}</li>`).join('')}</ul>`
      : '<p class="card__hint">No free hour together between 8 AM and 10 PM.</p>'}
    <p class="card__hint">Uses their classes plus your own classes and calendar. They might have other plans, so check with them.</p>`;
}

function openFriendWeek(f) {
  const sched = scheduleOf(f.id);
  if (!sched) return toast('They stopped sharing their schedule.');
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const label = (d, i) => (i === 0 ? 'Today' : fromKey(d).toLocaleDateString(undefined, { weekday: 'short' }));
  const html = `
    <div class="chip-row fw-days">${days.map((d, i) =>
      `<button type="button" class="fw-day" data-day="${d}" aria-pressed="${i === 0}">${label(d, i)}</button>`).join('')}</div>
    <div class="fw-body">${dayHTML(f, sched, today)}</div>`;
  openSheet(`${whoName(f)}’s week`, html, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      sheet.querySelectorAll('[data-day]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sheet.querySelector('.fw-body').innerHTML = dayHTML(f, sched, b.dataset.day);
    });
  });
}

const PING_EMOJI = { snack: '🍪', cheer: '📣', visit: '🐸', dance: '💃' };

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
  const hasClasses = getStudy().courses.some((c) => c.meetings?.length);
  const prefill = pendingInvite();
  if (prefill) clearPendingInvite();

  root.innerHTML = `
  <div class="friends-page stack">
    <div class="sheet__head">
      <a class="btn-plain btn-plain--muted" href="#/settings">back</a>
      <h1 class="page-title">Pond friends</h1>
      <span class="spacer"></span>
    </div>

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
      <h2 class="card__title">Class schedule</h2>
      <label class="row"><span>Share my class and lab times with friends</span><input type="checkbox" class="switch" id="share-schedule"${me.shareSchedule ? ' checked' : ''}></label>
      <p class="card__hint">${hasClasses
        ? 'Friends see course names and times only. Places, homework and your own calendar blocks stay private.'
        : 'Add class times in Study first, then friends can see when you’re free.'}</p>
    </section>

    ${incoming.length ? `<section class="card"><h2 class="card__title">Friend requests</h2><ul class="reqs">${incoming.map(requestCard).join('')}</ul></section>` : ''}

    <section class="card">
      <h2 class="card__title">Your pond friends ${friends.length ? `<span class="muted">(${friends.length})</span>` : ''}</h2>
      ${friends.length
        ? `<ul class="friends">${friends.map(friendCard).join('')}</ul>
           <p class="card__hint">Friends see your frog’s name and mood, plus your class times if you share them.</p>`
        : '<p class="card__hint">No friends yet. Share your code or invite link above!</p>'}
    </section>

    ${outgoing.length ? `<section class="card"><h2 class="card__title">Sent requests</h2><ul class="reqs">${outgoing.map(requestCard).join('')}</ul></section>` : ''}
  </div>`;

  const err = (m) => { root.querySelector('.form-error').textContent = m; };

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

  root.querySelector('#share-schedule').addEventListener('change', async (e) => {
    await saveProfile({ shareSchedule: e.target.checked });
    toast(e.target.checked ? 'Friends can see your class times now.' : 'Your schedule is private again.');
  });

  root.querySelector('.friends-page').addEventListener('click', async (e) => {
    const week = e.target.closest('[data-week]');
    if (week) { const f = friendsNow().find((x) => x.id === week.dataset.week); if (f) openFriendWeek(f); return; }
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
    if (accept) { await respondToRequest(accept.dataset.accept, true); play('ribbit'); toast('You’re pond friends now! 🐸'); return renderFriends(root); }
    const decline = e.target.closest('[data-decline]');
    if (decline) { await respondToRequest(decline.dataset.decline, false); return renderFriends(root); }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) { await removeFriend(cancel.dataset.cancel); toast('Request cancelled.'); return renderFriends(root); }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      if (!confirm('Remove this pond friend?')) return;
      await removeFriend(remove.dataset.remove);
      toast('Friend removed.');
      return renderFriends(root);
    }
  });

  // Re-render when friends/requests change (from a background sync), but only while this page is open.
  const onChange = () => { if (location.hash === '#/friends') renderFriends(root); };
  window.removeEventListener(FRIENDS_EVENT, root._friendsListener ?? (() => {}));
  root._friendsListener = onChange;
  window.addEventListener(FRIENDS_EVENT, onChange, { once: true });

  refreshFriends().catch(() => { /* offline: shows the last-known list */ });
  refreshSchedules().catch(() => { /* not set up yet or offline */ });
}
