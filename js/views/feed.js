import { addEntry, getSettings, getEntries } from '../data/db.js';
import { budget } from '../core/calc.js';
import { todayKey } from '../core/dates.js';
import { startEating } from '../pip/mood.js';
import { money, count } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

const TYPES = {
  swipe:    { label: 'swipe',  caption: 'Swipes used',           start: '1', whole: true },
  exchange: { label: 'swap',   caption: 'Exchanges used',        start: '1', whole: true },
  points:   { label: 'points', caption: 'Points spent',          start: '0', whole: false },
  fix:      { label: 'fix',    caption: 'Points on my card now', start: '0', whole: false },
};
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

export async function openFeedSheet({ type = 'points' } = {}) {
  const settings = await getSettings();
  if (!settings) return;
  const b = budget(settings, await getEntries(), todayKey());

  const startAmount = (t) => (t === 'fix' ? b.points.balance.toFixed(2) : TYPES[t].start);
  const state = { type, amount: startAmount(type), fresh: true };
  const opener = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <span class="sheet__grab" aria-hidden="true"></span>
      <div class="sheet__head">
        <button type="button" class="btn-plain btn-plain--muted" data-close>never mind</button>
        <h2 id="sheet-title" class="eyebrow">Feed Pip</h2>
        <span class="spacer"></span>
      </div>
      <div class="type-pills" role="group" aria-label="What did you use?">
        ${Object.entries(TYPES).map(([id, t]) => `<button type="button" data-type="${id}">${t.label}</button>`).join('')}
      </div>
      <div class="amount">
        <span class="amount__label"></span>
        <output class="amount__value" aria-live="polite"></output>
      </div>
      <div class="keypad">
        ${KEYS.map((k) => `<button type="button" data-key="${k}" aria-label="${k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}">${k}</button>`).join('')}
      </div>
      <p class="pip-note" aria-live="polite"></p>
      <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>Feed Pip</button>
    </div>`;

  const sheet = backdrop.querySelector('.sheet');
  const q = (sel) => sheet.querySelector(sel);

  function preview() {
    const n = parseFloat(state.amount) || 0;
    if (state.type === 'points') {
      const left = b.points.leftToday - n;
      return left >= 0 ? `Pip says: "${money(left)} left today after this!"` : `Pip says: "That's ${money(-left)} over today."`;
    }
    if (state.type === 'swipe') {
      const left = b.swipes.leftToday - n;
      return left >= 0 ? `Pip says: "${count(left)} swipes left today after this!"` : `Pip says: "That's ${count(-left)} swipes over today."`;
    }
    if (state.type === 'exchange') {
      const used = b.exchanges.used + n;
      return used <= b.exchanges.limit
        ? `Pip says: "${used} of ${b.exchanges.limit} exchanges this week."`
        : `Pip says: "That's over your ${b.exchanges.limit} per week!"`;
    }
    const diff = n - b.points.balance;
    return Math.abs(diff) < 0.005
      ? 'Pip says: "That matches what I have!"'
      : `Pip says: "I'll log a ${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} adjustment."`;
  }

  function update() {
    const t = TYPES[state.type];
    sheet.querySelectorAll('[data-type]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.type === state.type));
    });
    q('.amount__label').textContent = t.caption;
    const isMoney = state.type === 'points' || state.type === 'fix';
    q('.amount__value').textContent = (isMoney ? '$' : '') + state.amount;
    q('[data-key="."]').disabled = t.whole;
    q('.pip-note').textContent = preview();
  }

  function press(key) {
    const whole = TYPES[state.type].whole;
    let a = state.fresh ? '0' : state.amount;
    state.fresh = false;
    if (key === 'del') {
      a = a.length > 1 ? a.slice(0, -1) : '0';
    } else if (key === '.') {
      if (whole || a.includes('.')) return update();
      a += '.';
    } else {
      if (a.includes('.') && a.split('.')[1].length >= 2) return update();
      if (a.replace('.', '').length >= 6) return update();
      a = a === '0' ? key : a + key;
    }
    state.amount = a;
    update();
  }

  function close() {
    backdrop.remove();
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    opener?.focus?.();
  }

  async function save() {
    const n = parseFloat(state.amount);

    if (state.type === 'fix') {
      if (!Number.isFinite(n)) return;
      const diff = Math.round((n - b.points.balance) * 100) / 100;
      close();
      if (diff !== 0) await addEntry({ type: 'adjust-points', amount: diff });
      toast(diff !== 0 ? 'Balance updated to match your card.' : 'Already matches your card!');
      return;
    }

    if (!(n > 0)) { toast('Enter an amount first.'); return; }
    if (state.type === 'exchange' && b.exchanges.used + n > b.exchanges.limit &&
        !confirm(`That's past your ${b.exchanges.limit} exchanges this week. Log it anyway?`)) return;

    close();
    startEating();
    await addEntry({ type: state.type, amount: n });
    const what = state.type === 'points' ? money(n) : state.type === 'swipe' ? `${n} ${n === 1 ? 'swipe' : 'swipes'}` : `${n} ${n === 1 ? 'exchange' : 'exchanges'}`;
    toast(`Pip ate ${what}!`);
  }

  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.target.closest('button') && e.key === 'Enter') return; // let the focused button handle it
    if (/^[0-9.]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') save();
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) return close();
    const typeBtn = e.target.closest('[data-type]');
    if (typeBtn) {
      state.type = typeBtn.dataset.type;
      state.amount = startAmount(state.type);
      state.fresh = true;
      return update();
    }
    const keyBtn = e.target.closest('[data-key]');
    if (keyBtn) return press(keyBtn.dataset.key);
    if (e.target.closest('[data-save]')) save();
  });

  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  update();
  sheet.focus();
}