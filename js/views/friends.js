// Pond friends: your friend code + invite link, requests, and the friends list with ping buttons.
import { userNow, myProfile, appUrl, pendingInvite, clearPendingInvite } from '../data/auth.js';
import {
  refreshFriends, friendsNow, sendFriendRequest, respondToRequest, removeFriend, sendPing,
  PING_KINDS, whoName, FRIENDS_EVENT,
} from '../data/social.js';
import { frogSVG } from '../pip/frog.js';
import { MOOD_LABEL } from '../pip/mood.js';
import { formatShort } from '../core/dates.js';
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
    </div>
    <div class="friend__acts">
      ${Object.entries(PING_KINDS).map(([k, v]) =>
        `<button type="button" class="ping-btn" data-ping="${k}" data-id="${esc(f.id)}" title="${v.verb}" aria-label="${v.verb} — ${esc(whoName(f))}">${PING_EMOJI[k]}</button>`).join('')}
      <button type="button" class="btn-plain btn-plain--muted" data-remove="${esc(f.id)}" aria-label="Remove ${esc(whoName(f))}">✕</button>
    </div>
  </li>`;
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

    ${incoming.length ? `<section class="card"><h2 class="card__title">Friend requests</h2><ul class="reqs">${incoming.map(requestCard).join('')}</ul></section>` : ''}

    <section class="card">
      <h2 class="card__title">Your pond friends ${friends.length ? `<span class="muted">(${friends.length})</span>` : ''}</h2>
      ${friends.length
        ? `<ul class="friends">${friends.map(friendCard).join('')}</ul>
           <p class="card__hint">Friends see your frog’s name and mood — nothing else. Send a treat with the buttons!</p>`
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

  root.querySelector('.friends-page').addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied!'); }
      catch { toast('Couldn’t copy — press and hold to copy it.'); }
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
      try {
        await sendPing(ping.dataset.id, ping.dataset.ping);
        play('pop');
        toast(`${PING_KINDS[ping.dataset.ping].label} sent!`);
      } catch (er) { toast(er.message); }
      finally { setTimeout(() => { ping.disabled = false; }, 400); }
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
}
