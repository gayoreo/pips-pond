// Study tab: the planner (homework, assignments, exams, readings), courses and study reminders.
import {
  getStudy, addCourse, updateCourse, deleteCourse, addTask, updateTask, deleteTask, toggleDone,
  addSeries, stopSeries, ensureSeries, liveTasks, studyStatus, studyPipLine, dueLabel, studyNotifyPrefs,
  TASK_TYPES, COURSE_COLORS,
} from '../data/study.js';
import { getProfile, saveProfile, readAll } from '../data/db.js';
import { pushStatus } from '../data/push.js';
import { todayKey, addDays, dayOfWeek } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const view = { course: 'all', showDone: false }; // remembered while the app is open
const byDue = (a, b) => `${a.due}T${a.time || '99'}`.localeCompare(`${b.due}T${b.time || '99'}`);

// ---------- the list ----------
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

export async function renderStudy(root) {
  ensureSeries();
  const s = getStudy();
  const today = todayKey();
  const profile = await getProfile();
  const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  if (view.course !== 'all' && !courses[view.course]) view.course = 'all';

  const shown = liveTasks(s).filter((t) => view.course === 'all' || t.courseId === view.course);
  const open = shown.filter((t) => !t.done).sort(byDue);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const done = shown.filter((t) => t.done && (t.doneAt || '').slice(0, 10) >= addDays(today, -14))
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  const st = studyStatus(s, today);
  const line = studyPipLine(st, today)
    ?? (liveTasks(s).length ? 'All caught up for now. Nice.' : null);

  const chips = s.courses.length ? `
    <div class="chip-row course-chips" role="group" aria-label="Show one course">
      <button type="button" class="course-chip" data-course="all" aria-pressed="${view.course === 'all'}">All</button>
      ${s.courses.map((c) => `<button type="button" class="course-chip" data-course="${esc(c.id)}" aria-pressed="${view.course === c.id}" style="--course:${c.color}">${esc(c.name)}</button>`).join('')}
    </div>` : '';

  const body = !liveTasks(s).length ? `
    <section class="card study-empty">
      <p class="hand">Nothing planned yet.</p>
      <p class="card__hint">Add your homework, exams and readings, and ${esc(profile.frogName)} will keep an eye on due dates.</p>
      <div class="row">
        <button type="button" class="btn-sketch btn-sketch--go" data-add>+ add something</button>
        <button type="button" class="btn-sketch" data-courses>add courses</button>
      </div>
    </section>` : `
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

  root.innerHTML = `
  <div class="study stack">
    <header class="study__head">
      <div>
        <p class="eyebrow">Study</p>
        <h1 class="page-title">Planner</h1>
      </div>
      <button type="button" class="btn-sketch btn-sketch--go" data-add>+ add</button>
    </header>
    ${line ? `<p class="study__pip">“${esc(line)}”</p>` : ''}
    <div class="study__tools">
      <button type="button" class="btn-plain" data-courses>Courses</button>
      <button type="button" class="btn-plain" data-reminders>Reminders</button>
    </div>
    ${chips}
    ${body}
  </div>`;

  root.querySelector('.study').addEventListener('click', (e) => {
    const t = e.target;
    const doneBtn = t.closest('[data-done]');
    if (doneBtn) {
      const nowDone = toggleDone(doneBtn.dataset.done);
      play(nowDone ? 'pop' : 'stamp');
      return;
    }
    const openBtn = t.closest('[data-open]');
    if (openBtn) return openTaskSheet(getStudy().tasks.find((x) => x.id === openBtn.dataset.open));
    if (t.closest('[data-add]')) return openTaskSheet(null);
    if (t.closest('[data-courses]')) return openCoursesSheet();
    if (t.closest('[data-reminders]')) return openRemindersSheet();
    const chip = t.closest('[data-course]');
    if (chip) { view.course = chip.dataset.course; return renderStudy(root); }
    if (t.closest('[data-show-done]')) { view.showDone = !view.showDone; return renderStudy(root); }
    return undefined;
  });
}

// ---------- bottom sheet ----------
function openSheet(title, html, wire) {
  const opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `
    <div class="sheet study-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <span class="sheet__grab" aria-hidden="true"></span>
      <div class="sheet__head">
        <button type="button" class="btn-plain btn-plain--muted" data-close>close</button>
        <h2 class="eyebrow">${esc(title)}</h2>
        <span class="spacer"></span>
      </div>
      <div class="study-sheet__body">${html}</div>
    </div>`;
  const sheet = back.querySelector('.sheet');
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    back.remove();
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    opener?.focus?.();
  }
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.body.append(back);
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  sheet.focus();
  wire(sheet, close);
}

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

      // Save
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

// ---------- courses ----------
function coursesHTML() {
  const s = getStudy();
  return `
    ${s.courses.length ? `<ul class="course-list">${s.courses.map((c) => `
      <li class="course-row">
        <button type="button" class="course-swatch" data-recolor="${esc(c.id)}" style="background:${c.color}" aria-label="Change color for ${esc(c.name)}"></button>
        <input data-rename="${esc(c.id)}" value="${esc(c.name)}" maxlength="40" aria-label="Course name">
        <button type="button" class="btn-plain btn-plain--danger" data-remove="${esc(c.id)}">remove</button>
      </li>`).join('')}</ul>` : '<p class="card__hint">No courses yet. Adding them lets you color-code and filter the planner.</p>'}
    <form class="course-add" data-add-course>
      <label class="field grow">New course<input name="name" maxlength="40" autocomplete="off" placeholder="Bio 101"></label>
      <button type="submit" class="btn-sketch">add</button>
    </form>
    <p class="card__hint">Tap a color dot to change it.</p>`;
}

function openCoursesSheet() {
  openSheet('Courses', coursesHTML(), (sheet) => {
    const body = sheet.querySelector('.study-sheet__body');
    const redraw = () => { body.innerHTML = coursesHTML(); };
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return toast('Type the course name.');
      addCourse({ name });
      redraw();
      body.querySelector('[name="name"]').focus();
      return undefined;
    });
    sheet.addEventListener('change', (e) => {
      const id = e.target.dataset.rename;
      if (!id) return;
      const name = e.target.value.trim();
      if (name) updateCourse(id, { name });
    });
    sheet.addEventListener('click', (e) => {
      const recolor = e.target.closest('[data-recolor]');
      if (recolor) {
        const c = getStudy().courses.find((x) => x.id === recolor.dataset.recolor);
        if (!c) return;
        const next = COURSE_COLORS[(COURSE_COLORS.indexOf(c.color) + 1) % COURSE_COLORS.length];
        updateCourse(c.id, { color: next });
        redraw();
        return;
      }
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const c = getStudy().courses.find((x) => x.id === remove.dataset.remove);
        if (!c || !confirm(`Remove ${c.name}? Its homework stays in the planner, just without a course.`)) return;
        deleteCourse(c.id);
        redraw();
      }
    });
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
      const study = { ...studyNotifyPrefs(current), ...patch };
      await saveProfile({ notify: { ...current.notify, study } });
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
  const st = studyStatus(getStudy(), today);
  const soon = st.open.filter((t) => t.due <= addDays(today, 3)).slice(0, 3);
  if (!soon.length) return '';
  return `
  <section class="study-peek" aria-label="Coming up">
    <div class="study-peek__head">
      <p class="study-peek__title">Coming up</p>
      <a class="btn-plain" href="#/study">planner →</a>
    </div>
    <ul>${soon.map((t) => `
      <li><span>${esc(t.title)}</span><span class="${t.due < today ? 'is-late' : 'muted'}">${esc(dueLabel(t, today))}</span></li>`).join('')}
    </ul>
  </section>`;
}