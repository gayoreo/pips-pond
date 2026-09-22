// Course setup: name and color, class times, lab times, exams, then assignments and readings
// (typed in or pasted from a syllabus). Also used to edit a course's times later.
import { getStudy, saveCourse, parseSyllabus, liveTasks, TASK_TYPES, COURSE_COLORS } from '../data/study.js';
import { todayKey, formatShort, formatHM } from '../core/dates.js';
import { openTaskSheet } from './study.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEPS = ['basics', 'classes', 'labs', 'help', 'exams', 'work', 'review'];
const TITLES = {
  basics: 'Which course?', classes: 'When does class meet?', labs: 'Any lab times?',
  help: 'Office hours', exams: 'Exams', work: 'Assignments and readings', review: 'Look good?',
};
const w = {
  step: 0, id: '', name: '', code: '', color: '', meetings: [], exams: [], work: [], paste: '', existing: 0,
  prof: '', profEmail: '', ta: '', taEmail: '',
};

// When editing a course: what's already in the planner for it, so it can be edited from here.
// A weekly repeat shows once (its next copy).
function existingHTML(match) {
  if (!w.id) return '';
  const today = todayKey();
  const seen = new Set();
  const list = liveTasks(getStudy())
    .filter((t) => t.courseId === w.id && match(t))
    .sort((a, b) => a.due.localeCompare(b.due))
    .filter((t) => {
      if (!t.seriesId) return true;
      if (seen.has(t.seriesId) || t.done || t.due < today) return false;
      seen.add(t.seriesId);
      return true;
    });
  if (!list.length) return '';
  return `
    <section class="card">
      <h2 class="card__title">Already in your planner</h2>
      <ul class="existing-list">${list.map((t) => `
        <li>
          <span>${esc(t.title)} <span class="muted">${esc(formatShort(t.due))}${t.time ? ` ${esc(formatHM(t.time))}` : ''}${t.seriesId ? ' · weekly' : ''}${t.done ? ' · done' : ''}</span></span>
          <button type="button" class="btn-plain" data-edit-task="${esc(t.id)}">edit</button>
        </li>`).join('')}</ul>
    </section>`;
}

const blankMeeting = (kind) => ({ kind, days: [], start: '', end: '', place: '' });

export function beginCourseSetup(courseId) {
  const course = courseId ? getStudy().courses.find((c) => c.id === courseId) : null;
  Object.assign(w, {
    step: 0,
    id: course?.id ?? '',
    name: course?.name ?? '',
    code: course?.code ?? '',
    color: course?.color ?? COURSE_COLORS[getStudy().courses.length % COURSE_COLORS.length],
    meetings: (course?.meetings ?? []).map((m) => ({ ...m, days: [...m.days] })),
    prof: course?.prof ?? '',
    profEmail: course?.profEmail ?? '',
    ta: course?.ta ?? '',
    taEmail: course?.taEmail ?? '',
    exams: course ? [] : [{ title: 'Midterm 1', due: '', time: '', end: '' }, { title: 'Final exam', due: '', time: '', end: '' }],
    work: [],
    paste: '',
    existing: course ? liveTasks(getStudy()).filter((t) => t.courseId === course.id).length : 0,
  });
  location.hash = '#/course-setup';
}

function meetingRows(kind) {
  const rows = w.meetings.map((m, i) => ({ m, i })).filter(({ m }) => m.kind === kind);
  return rows.map(({ m, i }) => `
    <section class="card meet" data-i="${i}">
      <fieldset class="days-pick">
        <legend class="field">Days</legend>
        ${DAYS.map((name, d) => `<label class="daychip"><input type="checkbox" data-day="${d}"${m.days.includes(d) ? ' checked' : ''}><span>${name}</span></label>`).join('')}
      </fieldset>
      <div class="grid-2">
        <label class="field">Starts<input type="time" data-f="start" value="${esc(m.start)}"></label>
        <label class="field">Ends<input type="time" data-f="end" value="${esc(m.end)}"></label>
      </div>
      <label class="field"><span class="field__label">${kind === 'office' || kind === 'ta' ? 'Office' : 'Where'} <span class="muted">(optional)</span></span><input data-f="place" maxlength="60" value="${esc(m.place)}" placeholder="${kind === 'lab' ? 'Science 210' : kind === 'office' ? 'Votey 305' : kind === 'ta' ? 'Lab 112' : 'Room 104'}"></label>
      <button type="button" class="btn-plain btn-plain--danger" data-remove-meeting="${i}">remove</button>
    </section>`).join('');
}

function stepHTML() {
  const name = STEPS[w.step];
  if (name === 'basics') {
    return `
    <label class="field">Course name<input data-w="name" maxlength="40" autocomplete="off" value="${esc(w.name)}" placeholder="Calc 1"></label>
    <label class="field"><span class="field__label">Course code <span class="muted">(optional)</span></span><input data-w="code" maxlength="20" autocomplete="off" value="${esc(w.code)}" placeholder="MATH 151"></label>
    <p class="field">Color</p>
    <div class="chip-row" role="group" aria-label="Color">
      ${COURSE_COLORS.map((c) => `<button type="button" class="course-swatch" data-color="${c}" style="background:${c}" aria-pressed="${w.color === c}" aria-label="Color ${c}"></button>`).join('')}
    </div>`;
  }
  if (name === 'classes' || name === 'labs') {
    const kind = name === 'classes' ? 'class' : 'lab';
    return `
    <p class="card__hint">${kind === 'class'
      ? 'Add one row for each time slot. Mon, Wed and Fri at 10:00 is one row. A different time on Tuesday is a second row.'
      : 'Labs show separately on your week. Skip this if the course has no lab.'}</p>
    ${meetingRows(kind)}
    <button type="button" class="btn-sketch" data-add-meeting="${kind}">+ add ${kind === 'class' ? 'a class time' : 'a lab time'}</button>`;
  }
  if (name === 'help') {
    return `
    <p class="card__hint">Office hours show on your week in their own color. They never count as busy time, so free time and study slots ignore them.</p>
    <section class="card">
      <h2 class="card__title">Professor</h2>
      <div class="grid-2">
        <label class="field"><span class="field__label">Name <span class="muted">(optional)</span></span><input data-w="prof" maxlength="60" autocomplete="off" value="${esc(w.prof)}" placeholder="Dr. Nguyen"></label>
        <label class="field"><span class="field__label">Email <span class="muted">(optional)</span></span><input data-w="profEmail" type="email" maxlength="80" autocomplete="off" spellcheck="false" value="${esc(w.profEmail)}" placeholder="a.nguyen@uvm.edu"></label>
      </div>
    </section>
    ${meetingRows('office')}
    <button type="button" class="btn-sketch" data-add-meeting="office">+ add office hours</button>
    <section class="card">
      <h2 class="card__title">TA</h2>
      <div class="grid-2">
        <label class="field"><span class="field__label">Name <span class="muted">(optional)</span></span><input data-w="ta" maxlength="60" autocomplete="off" value="${esc(w.ta)}" placeholder="Sam"></label>
        <label class="field"><span class="field__label">Email <span class="muted">(optional)</span></span><input data-w="taEmail" type="email" maxlength="80" autocomplete="off" spellcheck="false" value="${esc(w.taEmail)}" placeholder="sam@uvm.edu"></label>
      </div>
    </section>
    ${meetingRows('ta')}
    <button type="button" class="btn-sketch" data-add-meeting="ta">+ add TA hours</button>`;
  }
  if (name === 'exams') {
    return `
    ${existingHTML((t) => t.type === 'exam')}
    <p class="card__hint">${w.existing ? 'Anything already in your planner stays. Exams you add here are added to it. ' : ''}Leave out any you don't know yet. You can add them later from the planner. With a start time, an exam shows on your week and takes over that slot.</p>
    ${w.exams.map((x, i) => `
      <section class="card meet" data-exam="${i}">
        <label class="field">Name<input data-x="title" maxlength="60" value="${esc(x.title)}"></label>
        <label class="field">Date<input type="date" data-x="due" value="${esc(x.due)}"></label>
        <div class="grid-2">
          <label class="field"><span class="field__label">Starts <span class="muted">(optional)</span></span><input type="time" data-x="time" value="${esc(x.time)}"></label>
          <label class="field"><span class="field__label">Ends <span class="muted">(optional)</span></span><input type="time" data-x="end" value="${esc(x.end || '')}"></label>
        </div>
        <button type="button" class="btn-plain btn-plain--danger" data-remove-exam="${i}">remove</button>
      </section>`).join('')}
    <button type="button" class="btn-sketch" data-add-exam>+ add an exam</button>`;
  }
  if (name === 'work') {
    return `
    ${existingHTML((t) => t.type !== 'exam')}
    <section class="card">
      <h2 class="card__title">Paste from your syllabus</h2>
      <p class="card__hint">One item per line with a date somewhere in it, like <b>Oct 3: Problem set 1</b> or <b>9/29 Read chapter 2</b>. Lines without a date are skipped.</p>
      <textarea class="study-notes" data-paste rows="5">${esc(w.paste)}</textarea>
      <button type="button" class="btn-sketch" data-read>read it</button>
    </section>
    ${w.work.length ? `<ul class="work-list">${w.work.map((x, i) => `
      <li class="card meet" data-work="${i}">
        <label class="field">What<input data-y="title" maxlength="80" value="${esc(x.title)}"></label>
        <div class="grid-2">
          <label class="field">Kind
            <select data-y="type">${['homework', 'assignment', 'reading', 'quiz', 'exam'].map((k) => `<option value="${k}"${x.type === k ? ' selected' : ''}>${TASK_TYPES[k].label}</option>`).join('')}</select>
          </label>
          <label class="field">Due<input type="date" data-y="due" value="${esc(x.due)}"></label>
        </div>
        <button type="button" class="btn-plain btn-plain--danger" data-remove-work="${i}">remove</button>
      </li>`).join('')}</ul>` : ''}
    <button type="button" class="btn-sketch" data-add-work>+ add one by hand</button>
    <p class="card__hint">Weekly homework (like a problem set every Friday) is easier to add from the planner with "Repeats every week".</p>`;
  }
  const classes = w.meetings.filter((m) => m.kind === 'class');
  const labs = w.meetings.filter((m) => m.kind === 'lab');
  const office = w.meetings.filter((m) => m.kind === 'office');
  const taHours = w.meetings.filter((m) => m.kind === 'ta');
  const exams = w.exams.filter((x) => x.title.trim() && x.due);
  const line = (m) => `${m.days.map((d) => DAYS[d]).join(', ')} ${esc(m.start)}${m.end ? ` to ${esc(m.end)}` : ''}${m.place ? `, ${esc(m.place)}` : ''}`;
  return `
    <section class="card" style="border-left: 10px solid ${w.color}">
      <h2 class="card__title">${esc(w.name)}${w.code ? ` <span class="muted">${esc(w.code)}</span>` : ''}</h2>
      <p><b>Class:</b> ${classes.length ? classes.map(line).join('; ') : 'none'}</p>
      <p><b>Lab:</b> ${labs.length ? labs.map(line).join('; ') : 'none'}</p>
      ${w.prof || office.length ? `<p><b>Professor:</b> ${esc(w.prof || 'not named')}${office.length ? ` · office hours ${office.map(line).join('; ')}` : ''}</p>` : ''}
      ${w.ta || taHours.length ? `<p><b>TA:</b> ${esc(w.ta || 'not named')}${taHours.length ? ` · hours ${taHours.map(line).join('; ')}` : ''}</p>` : ''}
      <p><b>Exams to add:</b> ${exams.length ? exams.map((x) => esc(x.title)).join(', ') : 'none'}</p>
      <p><b>Assignments and readings to add:</b> ${w.work.filter((x) => x.title.trim() && x.due).length}</p>
    </section>`;
}

function readStep(root) {
  root.querySelectorAll('[data-w]').forEach((el) => { w[el.dataset.w] = el.value; });
  root.querySelectorAll('.meet[data-i]').forEach((box) => {
    const m = w.meetings[Number(box.dataset.i)];
    m.days = [...box.querySelectorAll('[data-day]:checked')].map((x) => Number(x.dataset.day));
    box.querySelectorAll('[data-f]').forEach((el) => { m[el.dataset.f] = el.value; });
  });
  root.querySelectorAll('[data-exam]').forEach((box) => {
    const x = w.exams[Number(box.dataset.exam)];
    box.querySelectorAll('[data-x]').forEach((el) => { x[el.dataset.x] = el.value; });
  });
  root.querySelectorAll('[data-work]').forEach((box) => {
    const x = w.work[Number(box.dataset.work)];
    box.querySelectorAll('[data-y]').forEach((el) => { x[el.dataset.y] = el.value; });
  });
  const paste = root.querySelector('[data-paste]');
  if (paste) w.paste = paste.value;
}

function problem() {
  const name = STEPS[w.step];
  if (name === 'basics' && !w.name.trim()) return 'Type the course name.';
  if (name === 'classes' || name === 'labs' || name === 'help') {
    const kinds = name === 'classes' ? ['class'] : name === 'labs' ? ['lab'] : ['office', 'ta'];
    const mine = w.meetings.filter((m) => kinds.includes(m.kind));
    if (mine.find((m) => (m.days.length || m.start || m.end || m.place) && !(m.days.length && m.start))) {
      return 'Each row needs at least one day and a start time (or remove the row).';
    }
    if (mine.some((m) => m.end && m.start && m.end <= m.start)) return 'An end time is before its start time.';
  }
  if (name === 'exams') {
    const bad = w.exams.find((x) => x.title.trim() && !x.due);
    if (bad) return `${bad.title.trim()} needs a date, or remove it.`;
  }
  if (name === 'exams') {
    const late = w.exams.find((x) => x.title.trim() && x.time && x.end && x.end <= x.time);
    if (late) return `${late.title.trim()} ends before it starts.`;
  }
  if (name === 'work') {
    const bad = w.work.find((x) => x.title.trim() && !x.due);
    if (bad) return `${bad.title.trim()} needs a due date, or remove it.`;
  }
  return null;
}

export function renderCourseSetup(root) {
  if (!w.name && w.step === 0 && !w.meetings.length && !w.exams.length && location.hash === '#/course-setup' && !w.color) {
    location.hash = '#/study';
    return;
  }
  const last = w.step === STEPS.length - 1;
  root.innerHTML = `
  <div class="tutorial setup-flow">
    <div class="tutorial__top">
      <button type="button" class="btn-plain btn-plain--muted" data-cancel>cancel</button>
      <p class="eyebrow">${w.id ? 'Edit course' : 'Set up a course'} · ${w.step + 1} of ${STEPS.length}</p>
      <span class="spacer"></span>
    </div>
    <h1 class="page-title" tabindex="-1">${TITLES[STEPS[w.step]]}</h1>
    <div class="tutorial__body stack">${stepHTML()}</div>
    <div class="tutorial__dots" aria-hidden="true">${STEPS.map((_, i) => `<span class="${i <= w.step ? 'is-on' : ''}"></span>`).join('')}</div>
    <div class="tutorial__nav">
      <button type="button" class="btn-sketch" data-back${w.step === 0 ? ' disabled' : ''}>back</button>
      <button type="button" class="btn-sketch btn-sketch--go" data-next>${last ? 'Save course' : 'next'}</button>
    </div>
  </div>`;
  root.querySelector('h1').focus({ preventScroll: true });
  const page = root.querySelector('.setup-flow');
  const rerender = () => renderCourseSetup(root);

  page.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-cancel]')) {
      if (confirm('Leave without saving this course?')) location.hash = '#/study';
      return;
    }
    const color = t.closest('[data-color]');
    if (color) { readStep(root); w.color = color.dataset.color; return rerender(); }
    const addMeeting = t.closest('[data-add-meeting]');
    if (addMeeting) { readStep(root); w.meetings.push(blankMeeting(addMeeting.dataset.addMeeting)); return rerender(); }
    const rmMeeting = t.closest('[data-remove-meeting]');
    if (rmMeeting) { readStep(root); w.meetings.splice(Number(rmMeeting.dataset.removeMeeting), 1); return rerender(); }
    if (t.closest('[data-add-exam]')) { readStep(root); w.exams.push({ title: '', due: '', time: '', end: '' }); return rerender(); }
    const editTask = t.closest('[data-edit-task]');
    if (editTask) {
      readStep(root);
      const task = getStudy().tasks.find((x) => x.id === editTask.dataset.editTask);
      if (task) openTaskSheet(task, rerender);
      return undefined;
    }
    const rmExam = t.closest('[data-remove-exam]');
    if (rmExam) { readStep(root); w.exams.splice(Number(rmExam.dataset.removeExam), 1); return rerender(); }
    if (t.closest('[data-add-work]')) { readStep(root); w.work.push({ title: '', type: 'assignment', due: '' }); return rerender(); }
    const rmWork = t.closest('[data-remove-work]');
    if (rmWork) { readStep(root); w.work.splice(Number(rmWork.dataset.removeWork), 1); return rerender(); }
    if (t.closest('[data-read]')) {
      readStep(root);
      const { items, skipped } = parseSyllabus(w.paste, todayKey());
      if (!items.length) return toast('No dates found. Try lines like "Oct 3: Problem set 1".');
      for (const x of items) {
        if (x.type === 'exam') w.exams.push({ title: x.title, due: x.due, time: '', end: '' });
        else w.work.push(x);
      }
      w.paste = '';
      toast(`Found ${items.length}${skipped ? `, skipped ${skipped} without a date` : ''}. Check them below.`, 3500);
      return rerender();
    }
    if (t.closest('[data-back]')) { readStep(root); w.step = Math.max(0, w.step - 1); return rerender(); }
    if (t.closest('[data-next]')) {
      readStep(root);
      const bad = problem();
      if (bad) return toast(bad, 3500);
      if (!last) { w.step += 1; window.scrollTo(0, 0); return rerender(); }
      const tasks = [
        ...w.exams.filter((x) => x.title.trim() && x.due).map((x) => ({ title: x.title, type: 'exam', due: x.due, time: x.time, end: x.time ? x.end : '' })),
        ...w.work.filter((x) => x.title.trim() && x.due).map((x) => ({ title: x.title, type: x.type, due: x.due, time: '' })),
      ];
      saveCourse({
        id: w.id, name: w.name, code: w.code, color: w.color, meetings: w.meetings,
        people: { prof: w.prof, profEmail: w.profEmail, ta: w.ta, taEmail: w.taEmail },
      }, tasks);
      play('ribbit');
      toast(`${w.name.trim()} is set up${tasks.length ? ` with ${tasks.length} ${tasks.length === 1 ? 'thing' : 'things'} in your planner` : ''}.`, 3500);
      Object.assign(w, { name: '', color: '', meetings: [], exams: [], work: [], prof: '', profEmail: '', ta: '', taEmail: '' });
      location.hash = '#/study';
      return undefined;
    }
    return undefined;
  });
}