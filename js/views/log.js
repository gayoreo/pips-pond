import { getSettings, getEntries, saveSettings, deleteEntry } from '../data/db.js';
import { budget, isBaseChange } from '../core/calc.js';
import {
  todayKey, toKey, formatLong, formatTime, formatHM, monthKey, addMonths, daysInMonth, formatMonth, dayOfWeek,
} from '../core/dates.js';
import { moodFor, MOOD_LABEL } from '../pip/mood.js';
import { esc, money, plural } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openFeedSheet, describe } from './feed.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const view = { selected: null, month: null, journalCount: 10 }; // remembered while the app is open

function dayMood(settings, all, key) {
  if (key < settings.start || key > settings.end || key > todayKey()) return null;
  return moodFor(budget(settings, all, key));
}

function summary(list) {
  let swipes = 0, points = 0, exchanges = 0, guests = 0;
  for (const e of list) {
    if (e.type === 'swipe') swipes += e.amount;
    if (e.type === 'points') points += e.amount;
    if (e.type === 'exchange') exchanges += e.amount;
    if (e.type === 'guest') guests += e.amount;
  }
  const bits = [];
  if (swipes) bits.push(plural(swipes, 'swipe'));
  if (points) bits.push(`${money(points)} points`);
  if (exchanges) bits.push(plural(exchanges, 'exchange'));
  if (guests) bits.push(guests === 1 ? '1 guest pass' : `${guests} guest passes`);
  return bits.length ? `Total: ${bits.join(' · ')}` : '';
}

// The time to show: the one you set, else when it was logged (if that was the same day).
function entryTime(e) {
  if (e.time) return formatHM(e.time);
  if (e.createdAt && toKey(new Date(e.createdAt)) === e.date) return formatTime(e.createdAt);
  return '—';
}

// Sort key so timed entries sit in order and untimed ones fall back to when they were logged.
const entryOrder = (e) => `${e.time || (e.createdAt ? toKey(new Date(e.createdAt)) === e.date ? new Date(e.createdAt).toTimeString().slice(0, 5) : '' : '')}~${e.createdAt ?? ''}`;

function entryRow(e) {
  return `
    <li>
      <button type="button" class="entry" data-entry="${esc(e.id)}">
        <span class="entry__time">${entryTime(e)}</span>
        <span class="entry__what">${esc(describe(e.type, e.amount))}</span>
        <span class="entry__edit">${isBaseChange(e.type) ? 'remove' : 'edit'}</span>
      </button>
    </li>`;
}

function dayPageHTML(settings, all, key) {
  const list = all.filter((e) => e.date === key)
    .sort((a, c) => entryOrder(a).localeCompare(entryOrder(c)));
  const mood = dayMood(settings, all, key);
  const canAdd = key <= todayKey();
  return `
  <section class="card day-page" aria-label="${formatLong(key)}">
    <div class="day-page__head">
      <h2 class="card__title">${formatLong(key)}</h2>
      ${mood ? `<span class="mood-chip mood-chip--${mood}">${MOOD_LABEL[mood]}</span>` : ''}
    </div>
    ${list.length
      ? `<ul class="entries">${list.map(entryRow).join('')}</ul><p class="card__hint">${summary(list)}</p>`
      : `<p class="card__hint">${canAdd ? 'Nothing logged this day.' : 'Nobody can eat in the future!'}</p>`}
    ${canAdd ? `<button type="button" class="btn-sketch" data-add="${key}">+ add to this day</button>` : ''}
  </section>`;
}

function calendarHTML(settings, all) {
  const ym = view.month;
  const ws = settings.weekStart ?? 0;
  const offset = (dayOfWeek(`${ym}-01`) - ws + 7) % 7;
  const today = todayKey();
  const withEntries = new Set(all.map((e) => e.date));

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span aria-hidden="true"></span>');
  for (let d = 1; d <= daysInMonth(ym); d++) {
    const key = `${ym}-${String(d).padStart(2, '0')}`;
    const mood = dayMood(settings, all, key);
    const label = `${formatLong(key)}${mood ? `, mood: ${MOOD_LABEL[mood]}` : ''}${withEntries.has(key) ? ', has entries' : ''}`;
    cells.push(`
      <button type="button" class="cal__day${key === today ? ' is-today' : ''}${key === view.selected ? ' is-selected' : ''}"
        data-day="${key}" aria-pressed="${key === view.selected}" aria-label="${label}">
        ${d}${mood ? `<span class="cal__stamp cal__stamp--${mood}" aria-hidden="true"></span>` : ''}
      </button>`);
  }

  const heads = Array.from({ length: 7 }, (_, i) => `<span>${WEEKDAYS[(ws + i) % 7]}</span>`).join('');
  return `
  <section class="card cal">
    <div class="cal__nav">
      <button type="button" class="btn-plain" data-month="-1" aria-label="Previous month">‹</button>
      <h2 class="card__title">${formatMonth(ym)}</h2>
      <button type="button" class="btn-plain" data-month="1" aria-label="Next month">›</button>
    </div>
    <div class="cal__heads" aria-hidden="true">${heads}</div>
    <div class="cal__grid">${cells.join('')}</div>
    <div class="cal__legend">
      <span><i class="cal__stamp--happy"></i>happy</span>
      <span><i class="cal__stamp--worried"></i>close call</span>
      <span><i class="cal__stamp--sad"></i>over</span>
      <span><i class="cal__stamp--sleeping"></i>day off</span>
    </div>
  </section>`;
}

function journalHTML(settings, all) {
  const today = todayKey();
  const days = [...new Set([today, ...all.map((e) => e.date)])].filter((k) => k <= today).sort().reverse();
  const shown = days.slice(0, view.journalCount);
  return `
  <section class="card">
    <h2 class="card__title">Add to another day</h2>
    <div class="row">
      <label class="field grow">Day<input type="date" id="jump-day" max="${today}"></label>
      <button type="button" class="btn-sketch" id="jump-add">+ add</button>
    </div>
  </section>
  ${shown.map((k) => dayPageHTML(settings, all, k)).join('')}
  ${days.length > shown.length ? '<button type="button" class="btn-sketch" id="older">show older pages</button>' : ''}`;
}

export async function renderLog(root) {
  const settings = await getSettings();
  if (!settings) { location.hash = '#/settings'; return; }
  const all = await getEntries();

  view.selected ??= todayKey();
  view.month ??= monthKey(view.selected);
  const layout = settings.logView === 'journal' ? 'journal' : 'calendar';

  root.innerHTML = `
    <div class="log stack">
      <header class="log-head">
        <h1 class="page-title">Pond log</h1>
        <div class="seg seg--2" role="group" aria-label="Log layout">
          <button type="button" data-layout="calendar" aria-pressed="${layout === 'calendar'}">calendar</button>
          <button type="button" data-layout="journal" aria-pressed="${layout === 'journal'}">journal</button>
        </div>
      </header>
      ${layout === 'calendar' ? `<div class="log-split">${calendarHTML(settings, all)}${dayPageHTML(settings, all, view.selected)}</div>` : journalHTML(settings, all)}
    </div>`;

  root.querySelector('.log').addEventListener('click', async (e) => {
    const t = e.target;

    const layoutBtn = t.closest('[data-layout]');
    if (layoutBtn) return saveSettings({ ...settings, logView: layoutBtn.dataset.layout });

    const monthBtn = t.closest('[data-month]');
    if (monthBtn) { view.month = addMonths(view.month, Number(monthBtn.dataset.month)); return renderLog(root); }

    const dayBtn = t.closest('[data-day]');
    if (dayBtn) { view.selected = dayBtn.dataset.day; return renderLog(root); }

    const addBtn = t.closest('[data-add]');
    if (addBtn) return openFeedSheet({ type: 'points', date: addBtn.dataset.add });

    const entryBtn = t.closest('[data-entry]');
    if (entryBtn) {
      const entry = all.find((x) => x.id === entryBtn.dataset.entry);
      if (!entry) return;
      if (isBaseChange(entry.type)) {
        if (!confirm(`Remove this ${entry.type.startsWith('fund') ? 'added funds entry' : 'balance fix'}?`)) return;
        await deleteEntry(entry.id);
        return toast('Removed.');
      }
      return openFeedSheet({ entry });
    }

    if (t.closest('#older')) { view.journalCount += 10; return renderLog(root); }

    if (t.closest('#jump-add')) {
      const day = root.querySelector('#jump-day').value;
      if (!day) return toast('Pick a day first.');
      if (day > todayKey()) return toast('Nobody can eat in the future!');
      return openFeedSheet({ type: 'points', date: day });
    }
  });
}