// Study tab: Planner (homework, assignments, exams, readings), Week (classes, labs and your own blocks)
// and Decks (flashcards). Also the course list, calendar blocks and study reminder settings.
import {
  getStudy, addCourse, updateCourse, deleteCourse, addTask, updateTask, deleteTask, toggleDone,
  addSeries, stopSeries, ensureSeries, liveTasks, studyStatus, studyPipLine, dueLabel, studyNotifyPrefs,
  dayItems, freeGaps, timeRange, saveBlock, deleteBlock, TASK_TYPES, BLOCK_KINDS, COURSE_COLORS,
} from '../data/study.js';
import { getDecks, dueCards, totalDue, reviewStreak, addDeck } from '../data/decks.js';
import { getProfile, saveProfile, readAll } from '../data/db.js';
import { pushStatus } from '../data/push.js';
import { todayKey, addDays, dayOfWeek, startOfWeek, formatShort, formatHM, fromKey } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';
import { openSheet } from '../ui/sheet.js';
import { beginCourseSetup } from './courseSetup.js';
import { openDeck } from './decks.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODE_KEY = 'study:mode';
const view = { course: 'all', showDone: false, week: null }; // remembered while the app is open
const byDue = (a, b) => `${a.due}T${a.time || '99'}`.localeCompare(`${b.due}T${b.time || '99'}`);
const getMode = () => { try { return sessionStorage.getItem(MODE_KEY) || 'planner'; } catch { return 'planner'; } };
const setMode = (m) => { try { sessionStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const KIND_LABEL = { class: 'Class', lab: 'Lab', ...Object.fromEntries(Object.entries(BLOCK_KINDS).map(([k, v]) => [k, v.label])) };

// ---------- planner list ----------
function taskRow(t, courses, today) {
  const c = courses[t.courseId];
  const total = t.checklist?.length || 0;
  const ticked = t.checklist?.filter((i) => i.done).length || 0;
  const late = !t.done && t.due < today;
  const meta = [
    c ? esc(c.name) : '',
    TASK_TYPES[t.type]?.label ?? '',
    `<span class="${late ? 'is-late' : ''}">${esc(dueLabel(t, today))}</span>`,
    total ? `${ticked}/${total}` : '',
    t.seriesId ? 'weekly' : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="task task--${t.type}${t.done ? ' is-done' : ''}" style="--course:${c?.color ?? 'var(--tape)'}">
      <button type="button" class="task__check" data-done="${esc(t.id)}" aria-pressed="${t.done}"
        aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"></button>
      <button type="button" class="task__body" data-open="${esc(t.id)}">
        <span class="task__title">${esc(t.title)}</span>
        <span class="task__meta">${meta}</span>
      </button>
    </li>`;
}

function groupHTML(title, list, courses, today, extra = '') {
  if (!list.length) return '';
  return `
  <section class="plan-group ${extra}">
    <h2 class="plan-group__title">${title} <span class="muted">${list.length}</span></h2>
    <ul class="tasks">${list.map((t) => taskRow(t, courses, today)).join('')}</ul>
  </section>`;
}

function todayScheduleHTML(s, today) {
  const items = dayItems(s, today);
  if (!items.length) return '';
  const now = nowHM();
  return `
  <section class="today-sched" aria-label="Today's schedule">
    <p class="today-sched__title">Today</p>
    <ul>${items.map((i) => `
      <li class="${i.end && i.end < now ? 'is-past' : ''}" style="--course:${i.color ?? `var(--kind-${i.kind})`}">
        <span class="today-sched__time">${esc(timeRange(i))}</span>
        <span>${esc(i.title)}${i.kind === 'lab' ? ' lab' : ''}${i.place ? ` <span class="muted">· ${esc(i.place)}</span>` : ''}</span>
      </li>`).join('')}
    </ul>
  </section>`;
}

function plannerHTML(s, today, profile) {
  const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  if (view.course !== 'all' && !courses[view.course]) view.course = 'all';
  const shown = liveTasks(s).filter((t) => view.course === 'all' || t.courseId === view.course);
  const open = shown.filter((t) => !t.done).sort(byDue);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const done = shown.filter((t) => t.done && (t.doneAt || '').slice(0, 10) >= addDays(today, -14))
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  const chips = s.courses.length ? `
    <div class="chip-row course-chips" role="group" aria-label="Show one course">
      <button type="button" class="course-chip" data-course="all" aria-pressed="${view.course === 'all'}">All</button>
      ${s.courses.map((c) => `<button type="button" class="course-chip" data-course="${esc(c.id)}" aria-pressed="${view.course === c.id}" style="--course:${c.color}">${esc(c.name)}</button>`).join('')}
    </div>` : '';

  if (!liveTasks(s).length && !s.courses.length) {
    return `
    <section class="card study-empty">
      <p class="hand">Nothing planned yet.</p>
      <p class="card__hint">Set up your courses with class times, labs, exams and assignments, and ${esc(profile.frogName)} will keep an eye on due dates.</p>
      <div class="row">
        <button type="button" class="btn-sketch btn-sketch--go" data-setup>set up a course</button>
        <button type="button" class="btn-sketch" data-add>+ add one thing</button>
      </div>
    </section>`;
  }
  return `
    ${todayScheduleHTML(s, today)}
    ${chips}
    ${groupHTML('Overdue', open.filter((t) => t.due < today), courses, today, 'plan-group--late')}
    ${groupHTML('Today', open.filter((t) => t.due === today), courses, today)}
    ${groupHTML('Tomorrow', open.filter((t) => t.due === tomorrow), courses, today)}
    ${groupHTML('This week', open.filter((t) => t.due > tomorrow && t.due <= weekEnd), courses, today)}
    ${groupHTML('Later', open.filter((t) => t.due > weekEnd), courses, today)}
    ${!open.length ? '<p class="card__hint study-clear">Nothing left to do here.</p>' : ''}
    ${done.length ? `
      <button type="button" class="btn-plain btn-plain--muted" data-show-done aria-expanded="${view.showDone}">
        ${view.showDone ? 'hide' : 'show'} finished (${done.length})</button>
      ${view.showDone ? groupHTML('Finished', done, courses, today, 'plan-group--done') : ''}` : ''}`;
}

// ---------- week calendar ----------
function weekHTML(s, today) {
  const firstDay = readAll().settings?.weekStart ?? 1;
  view.week ??= startOfWeek(today, firstDay);
  const days = Array.from({ length: 7 }, (_, i) => addDays(view.week, i));
  const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  const tasks = liveTasks(s).filter((t) => !t.done);
  const now = nowHM();

  const dayCard = (day) => {
    const items = dayItems(s, day);
    const due = tasks.filter((t) => t.due === day);
    const gaps = day >= today ? freeGaps(items, { from: day === today && now > '08:00' ? now : '08:00' }) : [];
    const rows = [
      ...items.map((i) => ({ at: i.start, html: `
        <li class="wk-item wk-item--${i.kind}" style="--course:${i.color ?? `var(--kind-${i.kind})`}">
          <button type="button" ${i.block ? `data-block="${esc(i.block.id)}"` : `data-edit-course="${esc(i.course.id)}"`}>
            <span class="wk-item__time">${esc(timeRange(i))}</span>
            <span class="wk-item__title">${esc(i.title)}</span>
            <span class="wk-item__meta">${KIND_LABEL[i.kind] ?? ''}${i.place ? ` · ${esc(i.place)}` : ''}</span>
          </button>
        </li>` })),
      ...gaps.map((g) => ({ at: g.start, html: `
        <li class="wk-free">
          <span>Free ${esc(formatHM(g.start))} to ${esc(formatHM(g.end))}</span>
          <button type="button" class="btn-plain" data-study-at="${day}|${g.start}|${g.end}">+ study</button>
        </li>` })),
    ].sort((a, b) => a.at.localeCompare(b.at)).map((r) => r.html).join('');
    return `
    <section class="wk-day${day === today ? ' is-today' : ''}${day < today ? ' is-past' : ''}">
      <h3 class="wk-day__head">${DAYS[dayOfWeek(day)]} <span>${fromKey(day).getDate()}</span></h3>
      ${rows ? `<ul class="wk-list">${rows}</ul>` : '<p class="card__hint">Nothing scheduled.</p>'}
      ${due.length ? `<ul class="wk-due">${due.map((t) => `<li><button type="button" data-open="${esc(t.id)}" style="--course:${courses[t.courseId]?.color ?? 'var(--tape)'}">Due: ${esc(t.title)}${t.time ? ` <span class="muted">${esc(formatHM(t.time))}</span>` : ''}</button></li>`).join('')}</ul>` : ''}
    </section>`;
  };

  return `
    <div class="wk-nav">
      <button type="button" class="btn-plain" data-week="-7" aria-label="Previous week">‹</button>
      <p class="hand">${formatShort(days[0])} to ${formatShort(days[6])}</p>
      <button type="button" class="btn-plain" data-week="7" aria-label="Next week">›</button>
    </div>
    <div class="row wk-tools">
      ${view.week !== startOfWeek(today, firstDay) ? '<button type="button" class="btn-plain" data-week="now">this week</button>' : '<span></span>'}
      <button type="button" class="btn-sketch btn-sketch--small" data-add-block>+ add a block</button>
    </div>
    <p class="card__hint">Classes and labs come from your courses. Add work, appointments and study time as blocks. Open time between 8 AM and 10 PM shows as free.</p>
    <div class="wk-grid">${days.map(dayCard).join('')}</div>`;
}

// ---------- decks list ----------
function decksHTML(s) {
  const decks = getDecks();
  const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  const streak = reviewStreak();
  if (!decks.length) {
    return `
    <section class="card study-empty">
      <p class="hand">No decks yet.</p>
      <p class="card__hint">Make a deck, then paste in your terms. Copying from Quizlet, Sheets or a doc works.</p>
      <button type="button" class="btn-sketch btn-sketch--go" data-new-deck>+ new deck</button>
    </section>`;
  }
  return `
    ${streak > 1 ? `<p class="card__hint">Review streak: <b>${streak} days</b></p>` : ''}
    <ul class="deck-list">${decks.map((d) => {
      const due = dueCards(d).length;
      const c = courses[d.courseId];
      return `
      <li><button type="button" class="deck-row" data-deck="${esc(d.id)}" style="--course:${c?.color ?? 'var(--tape)'}">
        <span class="deck-row__name">${esc(d.name)}</span>
        <span class="deck-row__meta">${[c ? esc(c.name) : '', `${d.cards.length} ${d.cards.length === 1 ? 'card' : 'cards'}`, d.lastQuiz ? `last quiz ${d.lastQuiz.score}/${d.lastQuiz.total}` : ''].filter(Boolean).join(' · ')}</span>
        ${due ? `<span class="deck-row__due">${due} due</span>` : ''}
      </button></li>`;
    }).join('')}</ul>`;
}

// ---------- the page ----------
export async function renderStudy(root) {
  ensureSeries();
  const s = getStudy();
  const today = todayKey();
  const profile = await getProfile();
  const mode = getMode();

  let line = null;
  if (mode === 'decks') {
    const due = totalDue();
    line = due ? `${due} ${due === 1 ? 'card is' : 'cards are'} ready to review.` : getDecks().length ? 'No cards due. Nice work.' : null;
  } else {
    line = studyPipLine(studyStatus(s, today), today) ?? (liveTasks(s).length ? 'All caught up for now. Nice.' : null);
  }
  const title = { planner: 'Planner', week: 'Week', decks: 'Decks' }[mode];
  const addAttr = mode === 'decks' ? 'data-new-deck' : mode === 'week' ? 'data-add-block' : 'data-add';

  root.innerHTML = `
  <div class="study stack">
    <header class="study__head">
      <div><p class="eyebrow">Study</p><h1 class="page-title">${title}</h1></div>
      <button type="button" class="btn-sketch btn-sketch--go" ${addAttr}>+ add</button>
    </header>
    <div class="seg seg--3 study-mode" role="group" aria-label="Study view">
      ${['planner', 'week', 'decks'].map((m) => `<button type="button" data-mode="${m}" aria-pressed="${mode === m}">${m}</button>`).join('')}
    </div>
    ${line ? `<p class="study__pip">“${esc(line)}”</p>` : ''}
    <div class="study__tools">
      <button type="button" class="btn-plain" data-courses>Courses</button>
      <button type="button" class="btn-plain" data-reminders>Reminders</button>
    </div>
    ${mode === 'decks' ? decksHTML(s) : mode === 'week' ? weekHTML(s, today) : plannerHTML(s, today, profile)}
  </div>`;

  root.querySelector('.study').addEventListener('click', (e) => {
    const t = e.target;
    const modeBtn = t.closest('[data-mode]');
    if (modeBtn) { setMode(modeBtn.dataset.mode); return renderStudy(root); }
    const doneBtn = t.closest('[data-done]');
    if (doneBtn) { play(toggleDone(doneBtn.dataset.done) ? 'pop' : 'stamp'); return undefined; }
    const openBtn = t.closest('[data-open]');
    if (openBtn) return openTaskSheet(getStudy().tasks.find((x) => x.id === openBtn.dataset.open));
    if (t.closest('[data-add]')) return openTaskSheet(null);
    if (t.closest('[data-setup]')) return beginCourseSetup(null);
    if (t.closest('[data-courses]')) return openCoursesSheet();
    if (t.closest('[data-reminders]')) return openRemindersSheet();
    if (t.closest('[data-add-block]')) return openBlockSheet(null);
    if (t.closest('[data-new-deck]')) return openNewDeckSheet();
    const deck = t.closest('[data-deck]');
    if (deck) return openDeck(deck.dataset.deck);
    const block = t.closest('[data-block]');
    if (block) return openBlockSheet(getStudy().blocks.find((b) => b.id === block.dataset.block));
    const editCourse = t.closest('[data-edit-course]');
    if (editCourse) return beginCourseSetup(editCourse.dataset.editCourse);
    const studyAt = t.closest('[data-study-at]');
    if (studyAt) {
      const [date, start, end] = studyAt.dataset.studyAt.split('|');
      const endAt = start < '23:00' && end > addHour(start) ? addHour(start) : end;
      return openBlockSheet(null, { kind: 'study', date, start, end: endAt });
    }
    const wk = t.closest('[data-week]');
    if (wk) {
      view.week = wk.dataset.week === 'now' ? null : addDays(view.week, Number(wk.dataset.week));
      return renderStudy(root);
    }
    const chip = t.closest('[data-course]');
    if (chip) { view.course = chip.dataset.course; return renderStudy(root); }
    if (t.closest('[data-show-done]')) { view.showDone = !view.showDone; return renderStudy(root); }
    return undefined;
  });
}

const addHour = (hm) => { const [h, m] = hm.split(':').map(Number); return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// ---------- add / edit a task ----------
function checklistHTML(items) {
  if (!items.length) return '<li class="checklist__empty muted">No steps yet.</li>';
  return items.map((i, n) => `
    <li>
      <label><input type="checkbox" data-item-check="${n}"${i.done ? ' checked' : ''}><span>${esc(i.text)}</span></label>
      <button type="button" class="checklist__del" data-item-del="${n}" aria-label="Remove ${esc(i.text)}">✕</button>
    </li>`).join('');
}

function openTaskSheet(task) {
  const s = getStudy();
  const editing = Boolean(task);
  const today = todayKey();
  const semesterEnd = readAll().settings?.end;
  const d = {
    title: task?.title ?? '',
    type: task?.type ?? 'homework',
    courseId: task?.courseId ?? (view.course !== 'all' ? view.course : ''),
    due: task?.due ?? addDays(today, 1),
    time: task?.time ?? '',
    notes: task?.notes ?? '',
    checklist: (task?.checklist ?? []).map((i) => ({ ...i })),
  };
  const until = semesterEnd && semesterEnd > today ? semesterEnd : addDays(today, 105);

  const html = `
    <label class="field">What is it?<input name="title" maxlength="80" autocomplete="off" value="${esc(d.title)}" placeholder="Problem set 4"></label>
    <div class="type-pills" role="group" aria-label="Kind">
      ${Object.entries(TASK_TYPES).map(([k, v]) => `<button type="button" data-ttype="${k}" aria-pressed="${d.type === k}">${v.label}</button>`).join('')}
    </div>
    <label class="field">Course
      <select name="course">
        <option value="">No course</option>
        ${s.courses.map((c) => `<option value="${esc(c.id)}"${c.id === d.courseId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        <option value="__new">+ New course</option>
      </select>
    </label>
    <label class="field" data-newcourse hidden>New course name<input name="newCourse" maxlength="40" autocomplete="off" placeholder="Calc 1"></label>
    <div class="grid-2">
      <label class="field">Due<input type="date" name="due" value="${esc(d.due)}"></label>
      <label class="field"><span class="field__label">Time <span class="muted">(optional)</span></span><input type="time" name="time" value="${esc(d.time)}"></label>
    </div>
    ${editing ? '' : `
    <label class="row"><span>Repeats every week</span><input type="checkbox" class="switch" name="repeat"></label>
    <div class="stack" data-repeat hidden>
      <fieldset class="days-pick">
        <legend class="field">On</legend>
        ${DAYS.map((name, i) => `<label class="daychip"><input type="checkbox" name="days" value="${i}"><span>${name}</span></label>`).join('')}
      </fieldset>
      <label class="field">Until<input type="date" name="until" value="${esc(until)}"></label>
    </div>`}
    <section class="checklist-edit">
      <p class="field">Checklist</p>
      <ul class="checklist" data-list>${checklistHTML(d.checklist)}</ul>
      <div class="checklist__add">
        <textarea name="newItem" rows="1" placeholder="Add a step (paste a list to add several)"></textarea>
        <button type="button" class="btn-sketch btn-sketch--small" data-add-item>add</button>
      </div>
      <div class="checklist__range">
        <span>Problems</span>
        <input type="number" name="from" min="1" step="1" value="1" inputmode="numeric" aria-label="First problem">
        <span>to</span>
        <input type="number" name="to" min="1" step="1" inputmode="numeric" aria-label="Last problem">
        <button type="button" class="btn-plain" data-add-range>add</button>
      </div>
    </section>
    <label class="field">Notes<textarea name="notes" class="study-notes" rows="2">${esc(d.notes)}</textarea></label>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>${editing ? 'Save' : 'Add it'}</button>
    ${editing ? `
      <div class="row">
        <button type="button" class="btn-plain btn-plain--danger" data-delete>${task.seriesId ? 'delete this one' : 'delete'}</button>
        ${task.seriesId ? '<button type="button" class="btn-plain btn-plain--danger" data-stop>stop repeating</button>' : ''}
      </div>` : ''}`;

  openSheet(editing ? 'Edit' : 'Add to planner', html, (sheet, close) => {
    const q = (sel) => sheet.querySelector(sel);
    const f = (name) => sheet.querySelector(`[name="${name}"]`);
    const list = q('[data-list]');
    const redrawList = () => { list.innerHTML = checklistHTML(d.checklist); };
    if (!editing) f('title').focus();

    const pickDayOfDue = () => {
      const due = f('due').value;
      if (!due || !f('repeat')?.checked) return;
      if (![...sheet.querySelectorAll('[name="days"]:checked')].length) {
        const box = sheet.querySelector(`[name="days"][value="${dayOfWeek(due)}"]`);
        if (box) box.checked = true;
      }
    };

    sheet.addEventListener('change', (e) => {
      if (e.target.name === 'course') q('[data-newcourse]').hidden = e.target.value !== '__new';
      if (e.target.name === 'repeat') { q('[data-repeat]').hidden = !e.target.checked; pickDayOfDue(); }
      if (e.target.name === 'due') pickDayOfDue();
      if (e.target.dataset.itemCheck !== undefined) d.checklist[Number(e.target.dataset.itemCheck)].done = e.target.checked;
    });

    const addItems = () => {
      const lines = f('newItem').value.split(/\r?\n/).map((x) => x.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean);
      if (!lines.length) return;
      const stamp = Date.now().toString(36);
      lines.forEach((text, n) => d.checklist.push({ id: `c${stamp}${n}`, text, done: false }));
      f('newItem').value = '';
      redrawList();
    };
    f('newItem').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addItems(); } });

    sheet.addEventListener('click', (e) => {
      const t = e.target;
      const pill = t.closest('[data-ttype]');
      if (pill) {
        d.type = pill.dataset.ttype;
        sheet.querySelectorAll('[data-ttype]').forEach((b) => b.setAttribute('aria-pressed', String(b === pill)));
        return;
      }
      if (t.closest('[data-add-item]')) return addItems();
      if (t.closest('[data-add-range]')) {
        const from = Number(f('from').value);
        const to = Number(f('to').value);
        if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from)) return toast('Type the first and last problem number.');
        if (to - from > 99) return toast('That’s a lot of problems. Try 100 or fewer.');
        const stamp = Date.now().toString(36);
        for (let n = from; n <= to; n++) d.checklist.push({ id: `c${stamp}${n}`, text: `Problem ${n}`, done: false });
        f('to').value = '';
        return redrawList();
      }
      const del = t.closest('[data-item-del]');
      if (del) { d.checklist.splice(Number(del.dataset.itemDel), 1); return redrawList(); }

      if (t.closest('[data-delete]')) {
        if (!confirm(`Delete “${task.title}”?`)) return;
        deleteTask(task.id);
        close();
        return toast('Deleted.');
      }
      if (t.closest('[data-stop]')) {
        if (!confirm(`Stop repeating “${task.title}”? Upcoming copies are removed. Finished ones stay.`)) return;
        stopSeries(task.seriesId);
        close();
        return toast('Stopped repeating.');
      }
      if (!t.closest('[data-save]')) return;

      const title = f('title').value.trim();
      const due = f('due').value;
      const time = f('time').value;
      if (!title) return toast('Give it a name first.');
      if (!due) return toast('Pick a due date.');
      let courseId = f('course').value;
      if (courseId === '__new') {
        const name = f('newCourse').value.trim();
        if (!name) return toast('Type the new course’s name.');
        courseId = addCourse({ name }).id;
      }
      const fields = { title, type: d.type, courseId, due, time, notes: f('notes').value.trim(), checklist: d.checklist };

      if (!editing && f('repeat')?.checked) {
        const days = [...sheet.querySelectorAll('[name="days"]:checked')].map((x) => Number(x.value));
        const untilDay = f('until').value;
        if (!days.length) return toast('Pick which days it repeats.');
        if (untilDay && untilDay < due) return toast('The end date is before the first one.');
        addSeries({ title, type: d.type, courseId, time, days, start: due, until: untilDay, checklist: d.checklist.map((i) => i.text) });
        close();
        play('pop');
        return toast(`Added. ${title} repeats every ${days.map((n) => DAYS[n]).join(', ')}.`);
      }
      if (editing) {
        const allDone = fields.checklist.length > 0 && fields.checklist.every((i) => i.done);
        updateTask(task.id, allDone && !task.done ? { ...fields, done: true, doneAt: new Date().toISOString() } : fields);
        close();
        return toast('Saved.');
      }
      addTask(fields);
      close();
      play('pop');
      return toast(`Added ${title}.`);
    });
  });
}

// ---------- calendar blocks ----------
function openBlockSheet(block, preset = {}) {
  const editing = Boolean(block);
  const today = todayKey();
  const b = {
    kind: 'study', title: '', start: '15:00', end: '16:00', place: '', date: today, days: [], until: '',
    ...preset, ...(block ?? {}),
  };
  const weekly = editing ? b.days.length > 0 : false;
  const semesterEnd = readAll().settings?.end;
  const html = `
    <div class="type-pills" role="group" aria-label="Kind">
      ${Object.entries(BLOCK_KINDS).map(([k, v]) => `<button type="button" data-bkind="${k}" aria-pressed="${b.kind === k}">${v.label}</button>`).join('')}
    </div>
    <label class="field"><span class="field__label">Name <span class="muted">(optional)</span></span><input name="title" maxlength="60" autocomplete="off" value="${esc(b.title)}" placeholder="Library shift, dentist, Calc review"></label>
    <div class="grid-2">
      <label class="field">Starts<input type="time" name="start" value="${esc(b.start)}"></label>
      <label class="field">Ends<input type="time" name="end" value="${esc(b.end)}"></label>
    </div>
    <label class="row"><span>Every week</span><input type="checkbox" class="switch" name="weekly"${weekly ? ' checked' : ''}></label>
    <label class="field" data-once${weekly ? ' hidden' : ''}>Date<input type="date" name="date" value="${esc(b.date || today)}"></label>
    <div class="stack" data-weekly${weekly ? '' : ' hidden'}>
      <fieldset class="days-pick">
        <legend class="field">On</legend>
        ${DAYS.map((name, i) => `<label class="daychip"><input type="checkbox" name="days" value="${i}"${b.days.includes(i) ? ' checked' : ''}><span>${name}</span></label>`).join('')}
      </fieldset>
      <label class="field"><span class="field__label">Until <span class="muted">(optional)</span></span><input type="date" name="until" value="${esc(b.until || semesterEnd || '')}"></label>
    </div>
    <label class="field"><span class="field__label">Where <span class="muted">(optional)</span></span><input name="place" maxlength="60" autocomplete="off" value="${esc(b.place)}"></label>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>${editing ? 'Save' : 'Add it'}</button>
    ${editing ? '<button type="button" class="btn-plain btn-plain--danger" data-delete>delete</button>' : ''}`;

  openSheet(editing ? 'Edit block' : 'Add to your week', html, (sheet, close) => {
    const f = (name) => sheet.querySelector(`[name="${name}"]`);
    let kind = b.kind;
    sheet.addEventListener('change', (e) => {
      if (e.target.name === 'weekly') {
        sheet.querySelector('[data-once]').hidden = e.target.checked;
        sheet.querySelector('[data-weekly]').hidden = !e.target.checked;
        if (e.target.checked && !sheet.querySelector('[name="days"]:checked')) {
          const box = sheet.querySelector(`[name="days"][value="${dayOfWeek(f('date').value || today)}"]`);
          if (box) box.checked = true;
        }
      }
    });
    sheet.addEventListener('click', (e) => {
      const pill = e.target.closest('[data-bkind]');
      if (pill) {
        kind = pill.dataset.bkind;
        sheet.querySelectorAll('[data-bkind]').forEach((x) => x.setAttribute('aria-pressed', String(x === pill)));
        return;
      }
      if (e.target.closest('[data-delete]')) {
        if (!confirm('Delete this block?')) return;
        deleteBlock(block.id);
        close();
        toast('Deleted.');
        return;
      }
      if (!e.target.closest('[data-save]')) return;
      const start = f('start').value;
      const end = f('end').value;
      const isWeekly = f('weekly').checked;
      const days = [...sheet.querySelectorAll('[name="days"]:checked')].map((x) => Number(x.value));
      if (!start) { toast('Pick a start time.'); return; }
      if (end && end <= start) { toast('The end time is before the start time.'); return; }
      if (isWeekly && !days.length) { toast('Pick which days.'); return; }
      if (!isWeekly && !f('date').value) { toast('Pick a date.'); return; }
      saveBlock({
        id: block?.id, kind, title: f('title').value, start, end, place: f('place').value,
        weekly: isWeekly, days, date: f('date').value, until: f('until').value,
      });
      close();
      play('pop');
      toast(editing ? 'Saved.' : 'Added to your week.');
    });
  });
}

// ---------- courses ----------
function coursesHTML() {
  const s = getStudy();
  return `
    ${s.courses.length ? `<ul class="course-list">${s.courses.map((c) => {
      const meets = (c.meetings ?? []);
      const summary = [
        meets.filter((m) => m.kind === 'class').length ? `${meets.filter((m) => m.kind === 'class').length} class ${meets.filter((m) => m.kind === 'class').length === 1 ? 'time' : 'times'}` : '',
        meets.filter((m) => m.kind === 'lab').length ? `${meets.filter((m) => m.kind === 'lab').length} lab` : '',
      ].filter(Boolean).join(', ');
      return `
      <li class="course-row">
        <button type="button" class="course-swatch" data-recolor="${esc(c.id)}" style="background:${c.color}" aria-label="Change color for ${esc(c.name)}"></button>
        <span class="course-row__name"><b>${esc(c.name)}</b>${c.code ? ` <span class="muted">${esc(c.code)}</span>` : ''}<br><span class="muted">${summary || 'No class times yet'}</span></span>
        <button type="button" class="btn-plain" data-edit="${esc(c.id)}">edit</button>
        <button type="button" class="btn-plain btn-plain--danger" data-remove="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">✕</button>
      </li>`;
    }).join('')}</ul>` : '<p class="card__hint">No courses yet.</p>'}
    <button type="button" class="btn-sketch btn-sketch--go" data-setup-new>+ set up a course</button>
    <p class="card__hint">Setting up a course adds its class times, lab times, exams, assignments and readings in one go. Tap a color dot to change it.</p>`;
}

function openCoursesSheet() {
  openSheet('Courses', coursesHTML(), (sheet, close) => {
    const body = sheet.querySelector('.study-sheet__body');
    const redraw = () => { body.innerHTML = coursesHTML(); };
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-setup-new]')) { close(); beginCourseSetup(null); return; }
      const edit = e.target.closest('[data-edit]');
      if (edit) { close(); beginCourseSetup(edit.dataset.edit); return; }
      const recolor = e.target.closest('[data-recolor]');
      if (recolor) {
        const c = getStudy().courses.find((x) => x.id === recolor.dataset.recolor);
        if (!c) return;
        updateCourse(c.id, { color: COURSE_COLORS[(COURSE_COLORS.indexOf(c.color) + 1) % COURSE_COLORS.length] });
        redraw();
        return;
      }
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const c = getStudy().courses.find((x) => x.id === remove.dataset.remove);
        if (!c || !confirm(`Remove ${c.name}? Its class times go away. Its homework stays in the planner, just without a course.`)) return;
        deleteCourse(c.id);
        redraw();
      }
    });
  });
}

// ---------- new deck ----------
function openNewDeckSheet() {
  const s = getStudy();
  const html = `
    <label class="field">Deck name<input name="name" maxlength="60" autocomplete="off" placeholder="Bio chapter 3 terms"></label>
    <label class="field">Course
      <select name="course">
        <option value="">No course</option>
        ${s.courses.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>Make deck</button>`;
  openSheet('New deck', html, (sheet, close) => {
    const name = sheet.querySelector('[name="name"]');
    name.focus();
    const make = () => {
      if (!name.value.trim()) { toast('Give the deck a name.'); return; }
      const deck = addDeck({ name: name.value, courseId: sheet.querySelector('[name="course"]').value });
      close();
      openDeck(deck.id, { importNow: true });
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') make(); });
    sheet.querySelector('[data-save]').addEventListener('click', make);
  });
}

// ---------- study reminders ----------
async function openRemindersSheet() {
  const profile = await getProfile();
  const p = studyNotifyPrefs(profile);
  const push = await pushStatus();
  const note = push === 'on'
    ? 'Notifications are on for this device.'
    : 'These arrive as notifications. Turn notifications on in <a href="#/settings" data-close>Settings</a> first.';
  const sw = (key, label) => `<label class="row"><span>${label}</span><input type="checkbox" class="switch" data-pref="${key}"${p[key] ? ' checked' : ''}></label>`;
  const html = `
    <p class="card__hint">${note}</p>
    ${sw('on', 'Study reminders')}
    <div class="stack" data-sub${p.on ? '' : ' hidden'}>
      ${sw('agenda', 'Morning list of what’s due')}
      <label class="field">Send it at<input type="time" data-pref-time="agendaTime" value="${esc(p.agendaTime)}"></label>
      ${sw('overdue', 'Include overdue things')}
      ${sw('cards', 'Include flashcards that are due')}
      ${sw('nightBefore', 'Reminder the night before')}
      <label class="field">Send it at<input type="time" data-pref-time="nightTime" value="${esc(p.nightTime)}"></label>
      <label class="field">Warn me before exams
        <select data-pref-num="examDays">
          ${[[0, 'Off'], [1, '1 day before'], [2, '2 days before'], [3, '3 days before'], [5, '5 days before'], [7, '1 week before']]
            .map(([v, label]) => `<option value="${v}"${Number(p.examDays) === v ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
    </div>
    ${sw('pip', `${esc(profile.frogName)} reacts to homework and exams`)}
    <p class="card__hint">Changes save right away.</p>`;

  openSheet('Study reminders', html, (sheet) => {
    const save = async (patch) => {
      const current = await getProfile();
      await saveProfile({ notify: { ...current.notify, study: { ...studyNotifyPrefs(current), ...patch } } });
    };
    sheet.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.pref) {
        if (el.dataset.pref === 'on') sheet.querySelector('[data-sub]').hidden = !el.checked;
        save({ [el.dataset.pref]: el.checked });
      } else if (el.dataset.prefTime) {
        save({ [el.dataset.prefTime]: el.value || (el.dataset.prefTime === 'agendaTime' ? '08:00' : '20:00') });
      } else if (el.dataset.prefNum) {
        save({ [el.dataset.prefNum]: Number(el.value) });
      }
    });
  });
}

// ---------- small "coming up" card for the Pond ----------
export function studyPeekHTML(today = todayKey()) {
  const s = getStudy();
  const st = studyStatus(s, today);
  const soon = st.open.filter((t) => t.due <= addDays(today, 3)).slice(0, 3);
  const next = dayItems(s, today).find((i) => (i.kind === 'class' || i.kind === 'lab') && i.start >= nowHM());
  const cards = totalDue(today);
  if (!soon.length && !next && !cards) return '';
  return `
  <section class="study-peek" aria-label="Coming up">
    <div class="study-peek__head">
      <p class="study-peek__title">Coming up</p>
      <a class="btn-plain" href="#/study">study →</a>
    </div>
    <ul>
      ${next ? `<li><span>${esc(next.title)}${next.kind === 'lab' ? ' lab' : ''}</span><span class="muted">${esc(formatHM(next.start))}</span></li>` : ''}
      ${soon.map((t) => `<li><span>${esc(t.title)}</span><span class="${t.due < today ? 'is-late' : 'muted'}">${esc(dueLabel(t, today))}</span></li>`).join('')}
      ${cards ? `<li><span>Flashcards</span><span class="muted">${cards} due</span></li>` : ''}
    </ul>
  </section>`;
}