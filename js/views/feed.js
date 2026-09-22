import { addEntry, updateEntry, deleteEntry, getSettings, getEntries, getFavorites, getProfile } from '../data/db.js';
import { budget, exchangeAllowedOn } from '../core/calc.js';
import { todayKey, formatShort, formatTime, toKey } from '../core/dates.js';
import { startReaction } from '../pip/mood.js';
import { play } from '../ui/sound.js';
import { esc, money, plural } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

const TYPES = {
  swipe:    { label: 'swipe',  caption: 'Swipes used',           whole: true },
  exchange: { label: 'swap',   caption: 'Exchanges used',        whole: true },
  points:   { label: 'points', caption: 'Points spent',          whole: false },
  fix:      { label: 'fix',    caption: 'Points on my card now', whole: false },
};

export function describe(type, n) {
  if (type === 'points') return money(n);
  if (type === 'swipe') return plural(n, 'swipe');
  if (type === 'exchange') return plural(n, 'exchange');
  if (type === 'adjust-points') return `balance fix ${n > 0 ? '+' : '−'}${money(Math.abs(n))}`;
  if (type === 'adjust-swipes') return `balance fix ${n > 0 ? '+' : '−'}${plural(Math.abs(n), 'swipe')}`;
  if (type === 'fund-points') return `added ${money(n)} points`;
  if (type === 'fund-swipes') return `added ${plural(n, 'swipe')}`;
  if (type === 'guest') return plural(n, 'guest pass').replace('passs', 'passes');
  return String(n);
}

const overLimitMsg = (limit) => `That's past your ${limit} exchanges this week. Log it anyway?`;

// Frog reaction + sound after logging. Spending more than a whole day's points = shocked.
function react(type, amount, b) {
  const big = type === 'points' && b.points.daily > 0 && amount > b.points.daily;
  startReaction(big ? 'shocked' : 'eating', big ? 2200 : 1300);
  play(big ? 'whoa' : type === 'exchange' ? 'stamp' : 'chomp');
}

export async function quickLog({ type, amount = 1, label } = {}) {
  const settings = await getSettings();
  if (!settings) return;
  const { frogName } = await getProfile();
  const today = todayKey();
  const b = budget(settings, await getEntries(), today);

  if (type === 'exchange') {
    if (!b.exchanges.allowedToday) return toast('Exchanges aren’t available today.');
    if (b.exchanges.used + amount > b.exchanges.limit && !confirm(overLimitMsg(b.exchanges.limit))) return;
  }
  if (type === 'guest' && b.guests.left - amount < 0 &&
      !confirm(`That's more than your ${b.guests.total} guest passes. Log it anyway?`)) return;
  react(type, amount, b);
  await addEntry({ type, amount, date: today });
  toast(`${frogName} ate ${label ?? describe(type, amount)}!`);
}

export async function openFeedSheet({ type = 'points', entry = null, date = null } = {}) {
  const settings = await getSettings();
  if (!settings) return;
  const { frogName } = await getProfile();

  const editing = Boolean(entry);
  const day = entry?.date ?? date ?? todayKey();
  const isToday = day === todayKey();
  const dayWord = isToday ? 'today' : 'that day';
  const weekWord = isToday ? 'this week' : 'that week';
  const others = (await getEntries()).filter((e) => e.id !== entry?.id);
  const b = budget(settings, others, day);
  const favorites = editing ? [] : await getFavorites();
  const cents = settings.keypad === 'cents';
  const exchangeOk = exchangeAllowedOn(settings, day);
  const special = cents ? '00' : '.';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', special, '0', 'del'];
  const feedWord = `Feed ${frogName}`;

  const rawFor = (t, v) => {
    if (v == null) return '';
    if (TYPES[t].whole) return String(Math.round(v));
    return cents ? String(Math.round(v * 100)) : String(Number(Number(v).toFixed(2)));
  };
  const startValue = (t) => (t === 'fix' ? Math.max(0, b.points.balance) : TYPES[t].whole ? 1 : null);

  const state = { type: editing ? entry.type : type, raw: '', fresh: true };
  state.raw = rawFor(state.type, editing ? entry.amount : startValue(state.type));

  const value = () => {
    if (TYPES[state.type].whole) return parseInt(state.raw || '0', 10);
    if (cents) return Number(state.raw || '0') / 100;
    return parseFloat(state.raw || '0') || 0;
  };
  const display = () => {
    if (TYPES[state.type].whole) return state.raw || '0';
    if (cents) return '$' + (Number(state.raw || '0') / 100).toFixed(2);
    return '$' + (state.raw || '0');
  };

  let heading = isToday ? feedWord : `${feedWord} · ${formatShort(day)}`;
  if (editing) {
    const sameDay = entry.createdAt && toKey(new Date(entry.createdAt)) === entry.date;
    heading = `Edit · ${formatShort(day)}${sameDay ? `, ${formatTime(entry.createdAt)}` : ''}`;
  }

  const pillTypes = Object.keys(TYPES).filter((t) => !(editing && t === 'fix'));
  const opener = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <span class="sheet__grab" aria-hidden="true"></span>
      <div class="sheet__head">
        <button type="button" class="btn-plain btn-plain--muted" data-close>never mind</button>
        <h2 id="sheet-title" class="eyebrow">${esc(heading)}</h2>
        <span class="spacer"></span>
      </div>
      <div class="type-pills" role="group" aria-label="What did you use?" style="--pills:${pillTypes.length}">
        ${pillTypes.map((id) => `<button type="button" data-type="${id}"${id === 'exchange' && !exchangeOk ? ' disabled' : ''}>${TYPES[id].label}</button>`).join('')}
      </div>
      ${favorites.length ? `
      <div class="fav-row">
        <span class="fav-row__label">favs:</span>
        ${favorites.map((f) => `<button type="button" class="fav fav--${f.type}" data-fav="${esc(f.id)}">${esc(f.name)}</button>`).join('')}
        <button type="button" class="fav-row__edit" data-fav-edit>edit</button>
      </div>` : ''}
      <div class="amount">
        <span class="amount__label"></span>
        <output class="amount__value" aria-live="polite"></output>
      </div>
      <div class="keypad">
        ${keys.map((k) => `<button type="button" data-key="${k}" aria-label="${k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k === '00' ? 'Double zero' : k}"${k === '.' ? ' class="key-dot"' : ''}>${k}</button>`).join('')}
      </div>
      <p class="pip-note" aria-live="polite"></p>
      <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>${editing ? 'Save changes' : esc(feedWord)}</button>
      ${editing ? '<button type="button" class="btn-plain btn-plain--danger" data-delete>delete this entry</button>' : ''}
    </div>`;

  const sheet = backdrop.querySelector('.sheet');
  const q = (sel) => sheet.querySelector(sel);

  function preview() {
    const n = value();
    if (state.type === 'exchange') {
      if (!exchangeOk) return 'Exchanges aren’t available on this day.';
      const used = b.exchanges.used + n;
      return used <= b.exchanges.limit
        ? `${used} of ${b.exchanges.limit} exchanges ${weekWord}.`
        : `That's over your ${b.exchanges.limit} per week!`;
    }
    if (state.type === 'points') {
      const left = b.points.leftToday - n;
      return left >= -0.004 ? `${money(left)} left ${dayWord} after this!` : `That's ${money(-left)} over ${dayWord}.`;
    }
    if (state.type === 'swipe') {
      const left = b.swipes.leftToday - n;
      return left >= 0 ? `${plural(left, 'swipe')} left ${weekWord} after this!` : `That's ${plural(-left, 'swipe')} over ${weekWord}.`;
    }
    const diff = n - b.points.balance;
    return Math.abs(diff) < 0.005
      ? 'That matches what I have!'
      : `I'll log a ${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} adjustment.`;
  }

  function update() {
    sheet.querySelectorAll('[data-type]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.type === state.type));
    });
    q('.amount__label').textContent = TYPES[state.type].caption;
    q('.amount__value').textContent = display();
    q(`[data-key="${special}"]`).disabled = TYPES[state.type].whole;
    q('.pip-note').textContent = `${frogName} says: "${preview()}"`;
  }

  function press(key) {
    const whole = TYPES[state.type].whole;
    let a = state.fresh ? '' : state.raw;
    state.fresh = false;
    const digits = a.replace('.', '');

    if (key === 'del') {
      a = a.slice(0, -1);
    } else if (key === '.') {
      if (!whole && !cents && !a.includes('.')) a = (a || '0') + '.';
    } else if (key === '00') {
      if (!whole && cents && a !== '' && digits.length <= 4) a += '00';
    } else if (/^\d$/.test(key)) {
      const max = whole ? 3 : 6;
      const decimalsFull = !whole && !cents && a.includes('.') && a.split('.')[1].length >= 2;
      if (!decimalsFull && digits.length < max) {
        if (a === '0') a = key;
        else if (!(a === '' && key === '0' && (whole || cents))) a += key;
      }
    }
    state.raw = a;
    update();
  }

  function close() {
    backdrop.remove();
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    opener?.focus?.();
  }

  async function save() {
    const n = value();

    if (state.type === 'fix') {
      const diff = Math.round((n - b.points.balance) * 100) / 100;
      close();
      if (diff !== 0) await addEntry({ type: 'adjust-points', amount: diff, date: day });
      toast(diff !== 0 ? 'Balance updated to match your card.' : 'Already matches your card!');
      return;
    }

    if (!(n > 0)) return toast('Enter an amount first.');
    if (state.type === 'exchange') {
      if (!exchangeOk) return toast('Exchanges aren’t available on this day.');
      if (b.exchanges.used + n > b.exchanges.limit && !confirm(overLimitMsg(b.exchanges.limit))) return;
    }

    close();
    if (editing) {
      await updateEntry(entry.id, { type: state.type, amount: n });
      toast('Entry updated.');
      return;
    }
    react(state.type, n, b);
    await addEntry({ type: state.type, amount: n, date: day });
    toast(`${frogName} ate ${describe(state.type, n)}!`);
  }

  async function remove() {
    if (!confirm('Delete this entry?')) return;
    close();
    await deleteEntry(entry.id);
    toast('Entry deleted.');
  }

  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.target.closest('button') && e.key === 'Enter') return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === '.') press(cents ? '00' : '.');
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') save();
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-fav-edit]')) { close(); location.hash = '#/favorites'; return; }

    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      const f = favorites.find((x) => x.id === favBtn.dataset.fav);
      if (!f) return;
      if (f.type === 'exchange' && !exchangeOk) return toast('Exchanges aren’t available on this day.');
      state.type = f.type;
      state.raw = rawFor(f.type, f.amount);
      state.fresh = true;
      return update();
    }
    const typeBtn = e.target.closest('[data-type]');
    if (typeBtn) {
      state.type = typeBtn.dataset.type;
      state.raw = rawFor(state.type, startValue(state.type));
      state.fresh = true;
      return update();
    }
    const keyBtn = e.target.closest('[data-key]');
    if (keyBtn) return press(keyBtn.dataset.key);
    if (e.target.closest('[data-save]')) return save();
    if (e.target.closest('[data-delete]')) return remove();
  });

  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  update();
  sheet.focus();
}
// Links like ?log=swipe, ?log=points&amount=5.45 or ?fav=Latte (for iPhone Shortcuts / Back Tap).
export async function runShortcut(params) {
  const settings = await getSettings();
  if (!settings) return toast('Set up your semester first!');
  const fav = params.get('fav');
  if (fav) {
    const f = (await getFavorites()).find((x) => x.name.toLowerCase() === fav.toLowerCase());
    if (!f) return toast(`No favorite called “${fav}”.`);
    return quickLog({ type: f.type, amount: f.amount, label: `${f.name} (${describe(f.type, f.amount)})` });
  }
  const type = params.get('log');
  if (type === 'points') {
    const amount = Number(params.get('amount'));
    if (amount > 0) return quickLog({ type: 'points', amount: Math.round(amount * 100) / 100 });
    return openFeedSheet({ type: 'points' });
  }
  if (['swipe', 'exchange', 'guest'].includes(type)) return quickLog({ type, amount: 1 });
  return undefined;
}
