import { getFavorites, addFavorite, deleteFavorite, moveFavorite } from '../data/db.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { describe } from './feed.js';

const TYPES = [['points', 'points'], ['swipe', 'swipe'], ['exchange', 'exchange']];
let draftType = 'points';

export async function renderFavorites(root) {
  const favs = await getFavorites();

  root.innerHTML = `
    <div class="stack favs-page">
      <div class="sheet__head">
        <button type="button" class="btn-plain btn-plain--muted" data-back>back</button>
        <h1 class="page-title">Favorites</h1>
        <span class="spacer"></span>
      </div>
      <p class="card__hint">Tap a favorite on the Pond page to log it in one go, or in the Feed Pip sheet to fill in the amount.</p>

      ${favs.length ? `
      <ul class="fav-list">
        ${favs.map((f, i) => `
          <li class="fav-item fav-item--${f.type}">
            <span class="fav-item__text">
              <span class="hand fav-item__name">${esc(f.name)}</span>
              <span class="muted">${esc(describe(f.type, f.amount))}</span>
            </span>
            <button type="button" class="icon-btn" data-up="${esc(f.id)}" aria-label="Move ${esc(f.name)} up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="icon-btn icon-btn--danger" data-del="${esc(f.id)}" aria-label="Delete ${esc(f.name)}">✕</button>
          </li>`).join('')}
      </ul>` : '<p class="hand muted">No favorites yet. Add your usual orders below!</p>'}

      <form class="card" id="fav-form" novalidate>
        <h2 class="card__title">New favorite</h2>
        <div class="grid-2">
          <label class="field">Name<input name="name" maxlength="24" autocomplete="off"></label>
          <label class="field">Amount<input name="amount" type="number" inputmode="decimal" min="0" step="${draftType === 'points' ? '0.01' : '1'}"></label>
        </div>
        <div class="seg" role="group" aria-label="Type">
          ${TYPES.map(([id, label]) => `<button type="button" data-ftype="${id}" aria-pressed="${draftType === id}">${label}</button>`).join('')}
        </div>
        <button type="submit" class="btn-sketch btn-sketch--go">save favorite</button>
      </form>
    </div>`;

  const page = root.querySelector('.favs-page');
  const form = root.querySelector('#fav-form');

  page.addEventListener('click', async (e) => {
    if (e.target.closest('[data-back]')) {
      if (history.length > 1) history.back(); else location.hash = '#/pond';
      return;
    }
    const typeBtn = e.target.closest('[data-ftype]');
    if (typeBtn) {
      draftType = typeBtn.dataset.ftype;
      page.querySelectorAll('[data-ftype]').forEach((b) => b.setAttribute('aria-pressed', String(b === typeBtn)));
      form.amount.step = draftType === 'points' ? '0.01' : '1';
      return;
    }
    const up = e.target.closest('[data-up]');
    if (up) return moveFavorite(up.dataset.up, -1);
    const del = e.target.closest('[data-del]');
    if (del && confirm('Delete this favorite?')) return deleteFavorite(del.dataset.del);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const amount = Number(form.amount.value);
    if (!name) return toast('Give it a name.');
    if (!(amount > 0)) return toast('Enter an amount.');
    if (draftType !== 'points' && !Number.isInteger(amount)) return toast('Swipes and exchanges are whole numbers.');
    await addFavorite({ name, type: draftType, amount: draftType === 'points' ? Math.round(amount * 100) / 100 : amount });
    toast('Saved!');
  });
}