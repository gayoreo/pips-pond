// Study planner data: courses, tasks (homework, assignments, exams, readings) and weekly repeats.
// Saved with the rest of your pond and synced as one piece called "study".
import { readAll, writeAll, newId, semesterKey } from './db.js';
import { todayKey, addDays, dayOfWeek, fromKey, formatShort, formatHM, toKey } from '../core/dates.js';
import { cardsDueMap } from './decks.js';

export const TASK_TYPES = {
  homework:   { label: 'Homework' },
  assignment: { label: 'Assignment' },
  exam:       { label: 'Exam' },
  reading:    { label: 'Reading' },
};

export const COURSE_COLORS = ['#CFE3F7', '#FCE7A8', '#E6D3EE', '#CDEBCF', '#F7D2C9', '#E3DAC4'];

export const DEFAULT_STUDY_NOTIFY = {
  on: true,            // study reminders at all
  agenda: true,        // morning list of what's due today
  agendaTime: '08:00',
  nightBefore: true,   // evening reminder for anything due tomorrow
  nightTime: '20:00',
  examDays: 3,         // exam heads-up this many days before (0 = off)
  overdue: true,       // include overdue things in the morning list
  cards: true,         // mention flashcards that are due in the morning list
  pip: true,           // Pip's mood reacts to homework and exams
};

// The part of the day that counts for free time and "+ study" (you can change it in Study settings).
export const DEFAULT_HOURS = { from: '08:00', to: '22:00' };
export function studyHours(profile) {
  const h = { ...DEFAULT_HOURS, ...(profile?.studyHours ?? {}) };
  return h.to > h.from ? h : { ...DEFAULT_HOURS };
}

const blank = () => ({ courses: [], tasks: [], series: [], blocks: [] });

function norm(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return blank();
  return {
    courses: Array.isArray(s.courses) ? s.courses : [],
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    series: Array.isArray(s.series) ? s.series : [],
    blocks: Array.isArray(s.blocks) ? s.blocks : [],
  };
}

// Courses belong to a semester (semKey = that semester's lasting id). Only the current semester's
// courses, and their homework, show up. Switching semesters just changes which ones you see.
function forSemester(s, data) {
  const cur = data.settings?.key || '';
  const known = new Set([cur, ...(data.archive ?? []).map((a) => a.settings?.key).filter(Boolean)]);
  const mine = (c) => !c.semKey || c.semKey === cur || !known.has(c.semKey);
  const hidden = new Set(s.courses.filter((c) => !mine(c)).map((c) => c.id));
  return { ...s, courses: s.courses.filter(mine), tasks: s.tasks.filter((t) => !hidden.has(t.courseId)), allCourses: s.courses };
}

export const getStudy = () => { const data = readAll(); return forSemester(norm(data.study), data); };

// Every course made before semesters were tracked joins the current semester (once).
export function ensureCourseSemesters() {
  const key = semesterKey();
  if (!key || !norm(readAll().study).courses.some((c) => !c.semKey)) return;
  change((st) => { for (const c of st.courses) if (!c.semKey) c.semKey = key; }, false);
}

// Courses that belong to one semester (by its lasting id), for past semesters and exports.
export const coursesForSemester = (key) => (key ? norm(readAll().study).courses.filter((c) => c.semKey === key) : []);

// Runs `fn` on a copy of the study data, saves it, and marks it for syncing.
function change(fn, notify = true) {
  const data = readAll();
  const study = norm(data.study);
  const result = fn(study);
  data.study = study;
  data.meta = { ...(data.meta || {}), study: new Date().toISOString() };
  writeAll(data, notify);
  return result;
}

export const studyNotifyPrefs = (profile) => ({ ...DEFAULT_STUDY_NOTIFY, ...(profile?.notify?.study ?? {}) });

// ---------- courses ----------
export const addCourse = ({ name, color }) => { const semKey = semesterKey(); return change((s) => {
  const course = { id: newId(), semKey, name: name.trim(), color: color || COURSE_COLORS[s.courses.length % COURSE_COLORS.length] };
  s.courses.push(course);
  return course;
}); };

export const updateCourse = (id, patch) => change((s) => {
  const c = s.courses.find((x) => x.id === id);
  if (c) Object.assign(c, patch);
});

// Saves a whole course from the setup screens: name, code, color, who teaches it, class, lab
// and office hour times, plus any new exams, assignments and readings. Returns the course.
// meetings: [{ kind: 'class' | 'lab' | 'office' | 'ta', days: [0-6], start: 'HH:MM', end: 'HH:MM', place }]
export const MEETING_KINDS = ['class', 'lab', 'office', 'ta'];
export const saveCourse = ({ id, name, code = '', color, meetings = [], people = {} }, newTasks = []) => { const semKey = semesterKey(); return change((s) => {
  let course = id ? s.courses.find((c) => c.id === id) : null;
  const clean = meetings
    .filter((m) => m.days?.length && m.start)
    .map((m) => ({ id: m.id || newId(), kind: MEETING_KINDS.includes(m.kind) ? m.kind : 'class', days: [...m.days].sort(), start: m.start, end: m.end || '', place: (m.place || '').trim() }));
  const who = {
    prof: (people.prof ?? '').trim(), profEmail: (people.profEmail ?? '').trim(),
    ta: (people.ta ?? '').trim(), taEmail: (people.taEmail ?? '').trim(),
  };
  if (course) Object.assign(course, { name: name.trim(), code: code.trim(), color: color || course.color, meetings: clean, ...who });
  else {
    course = { id: newId(), semKey, name: name.trim(), code: code.trim(), color: color || COURSE_COLORS[s.courses.length % COURSE_COLORS.length], meetings: clean, ...who };
    s.courses.push(course);
  }
  for (const t of newTasks) {
    s.tasks.push({
      id: newId(), courseId: course.id, title: t.title.trim(), type: t.type, due: t.due, time: t.time || '', end: t.end || '',
      done: false, doneAt: '', checklist: [], notes: '',
    });
  }
  return course;
}); };

export const deleteCourse = (id) => change((s) => {
  s.courses = s.courses.filter((c) => c.id !== id);
  for (const t of s.tasks) if (t.courseId === id) t.courseId = '';
  for (const r of s.series) if (r.courseId === id) r.courseId = '';
});

// ---------- grades ----------
// course.grading = { mode, categories: [{ id, name, weight, drop, bonus }], scale, credits, passFail, passMin, replaceLowest, examCat }
// course.grades  = [{ id, name, catId, earned, possible, status: 'graded'|'pending'|'excused', extra, isFinal, taskId }]
// course.extras  = [{ id, kind: 'points'|'percent', amount, note }]
const findCourse = (s, id) => s.courses.find((c) => c.id === id);

export const saveGrading = (courseId, grading) => change((s) => {
  const c = findCourse(s, courseId);
  if (!c) return;
  const cats = (grading.categories ?? []).map((x) => ({ ...x, id: x.id || newId(), name: (x.name || '').trim() || 'Category' }));
  c.grading = { ...(c.grading ?? {}), ...grading, categories: cats };
  const ids = new Set(cats.map((x) => x.id));
  for (const it of c.grades ?? []) if (!ids.has(it.catId)) it.catId = cats[0]?.id ?? '';
});

export const saveGradeItem = (courseId, item) => change((s) => {
  const c = findCourse(s, courseId);
  if (!c) return null;
  c.grades ??= [];
  const clean = { status: 'graded', extra: '', ...item, id: item.id || newId(), name: (item.name || '').trim() || 'Untitled' };
  if (clean.isFinal) for (const it of c.grades) if (it.id !== clean.id) it.isFinal = false;
  const i = c.grades.findIndex((x) => x.id === clean.id);
  if (i >= 0) c.grades[i] = clean; else c.grades.push(clean);
  return clean;
});

export const deleteGradeItem = (courseId, itemId) => change((s) => {
  const c = findCourse(s, courseId);
  if (c) c.grades = (c.grades ?? []).filter((x) => x.id !== itemId);
});

export const saveExtra = (courseId, extra) => change((s) => {
  const c = findCourse(s, courseId);
  if (!c) return;
  c.extras ??= [];
  const clean = { ...extra, id: extra.id || newId() };
  const i = c.extras.findIndex((x) => x.id === clean.id);
  if (i >= 0) c.extras[i] = clean; else c.extras.push(clean);
});

export const deleteExtra = (courseId, extraId) => change((s) => {
  const c = findCourse(s, courseId);
  if (c) c.extras = (c.extras ?? []).filter((x) => x.id !== extraId);
});

// Finished homework, assignments and exams that don't have a score yet.
export function needsScore(s) {
  const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  return liveTasks(s).filter((t) => t.done && !t.noScore && t.type !== 'reading' && courses[t.courseId]
    && !(courses[t.courseId].grades ?? []).some((g) => g.taskId === t.id))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export const skipScore = (taskId) => change((s) => {
  const t = s.tasks.find((x) => x.id === taskId);
  if (t) t.noScore = true;
});

// ---------- tasks ----------
const checklistFrom = (items, prefix) =>
  (items ?? []).map((text, i) => ({ id: `${prefix}:${i}`, text, done: false }));

export const addTask = (t) => change((s) => {
  const task = {
    id: newId(), courseId: '', title: '', type: 'homework', due: todayKey(), time: '',
    done: false, doneAt: '', checklist: [], notes: '', ...t,
  };
  s.tasks.push(task);
  return task;
});

export const updateTask = (id, patch) => change((s) => {
  const t = s.tasks.find((x) => x.id === id);
  if (t) Object.assign(t, patch);
});

// Tasks from a weekly repeat are kept as hidden markers so they don't come back.
export const deleteTask = (id) => change((s) => {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.seriesId) Object.assign(t, { deleted: true });
  else s.tasks = s.tasks.filter((x) => x.id !== id);
});

export const toggleDone = (id) => change((s) => {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return false;
  t.done = !t.done;
  t.doneAt = t.done ? new Date().toISOString() : '';
  return t.done;
});

// Ticking the last checklist item finishes the task. Unticking one reopens it.
export const toggleCheck = (taskId, itemId) => change((s) => {
  const t = s.tasks.find((x) => x.id === taskId);
  const item = t?.checklist.find((i) => i.id === itemId);
  if (!item) return false;
  item.done = !item.done;
  const allDone = t.checklist.length > 0 && t.checklist.every((i) => i.done);
  if (allDone && !t.done) { t.done = true; t.doneAt = new Date().toISOString(); }
  if (!item.done && t.done) { t.done = false; t.doneAt = ''; }
  return allDone;
});

// ---------- weekly repeats ----------
const HORIZON = 21; // days ahead that repeats are filled in

function fillSeries(s, r, today) {
  const last = addDays(today, HORIZON);
  const to = r.until && r.until < last ? r.until : last;
  let k = r.filledTo ? addDays(r.filledTo, 1) : r.start;
  let added = 0;
  for (; k <= to; k = addDays(k, 1)) {
    if (!r.days.includes(dayOfWeek(k))) continue;
    const id = `${r.id}:${k}`;
    if (s.tasks.some((t) => t.id === id)) continue;
    s.tasks.push({
      id, seriesId: r.id, courseId: r.courseId, title: r.title, type: r.type, due: k, time: r.time || '',
      done: false, doneAt: '', checklist: checklistFrom(r.checklist, id), notes: '',
    });
    added++;
  }
  if (to > (r.filledTo || '')) r.filledTo = to;
  return added;
}

export const addSeries = (r) => change((s) => {
  const series = { id: newId(), courseId: '', type: 'homework', time: '', checklist: [], until: '', ...r };
  s.series.push(series);
  fillSeries(s, series, todayKey());
  return series;
});

// Stops a repeat: removes its unfinished future copies and keeps everything already done.
export const stopSeries = (seriesId) => change((s) => {
  const today = todayKey();
  s.series = s.series.filter((r) => r.id !== seriesId);
  s.tasks = s.tasks.filter((t) => !(t.seriesId === seriesId && !t.done && t.due >= today));
});

// Every copy of a weekly repeat (skipped ones included), by date.
export const seriesTasks = (s, seriesId) => s.tasks.filter((t) => t.seriesId === seriesId).sort((a, b) => a.due.localeCompare(b.due));

// Puts a deleted task or block back, for undo.
export const restoreTaskObject = (task) => change((s) => { if (task && !s.tasks.some((t) => t.id === task.id)) s.tasks.push(task); });
export const restoreBlockObject = (block) => change((s) => { if (block && !s.blocks.some((b) => b.id === block.id)) s.blocks.push(block); });

// Brings back a skipped copy of a weekly repeat.
export const restoreTask = (id) => change((s) => {
  const t = s.tasks.find((x) => x.id === id);
  if (t) delete t.deleted;
});

// Changes a weekly repeat and its unfinished copies from `fromDue` on. Finished copies are left alone.
export const updateSeries = (seriesId, patch, fromDue) => change((s) => {
  const r = s.series.find((x) => x.id === seriesId);
  if (r) {
    for (const k of ['title', 'type', 'courseId', 'time']) if (k in patch) r[k] = patch[k];
    if (patch.checklist) r.checklist = patch.checklist.map((i) => i.text);
  }
  for (const t of s.tasks) {
    if (t.seriesId !== seriesId || t.done || t.due < fromDue) continue;
    for (const k of ['title', 'type', 'courseId', 'time', 'end', 'notes']) if (k in patch) t[k] = patch[k];
    if (patch.checklist) t.checklist = patch.checklist.map((i, n) => ({ id: `${t.id}:${n}`, text: i.text, done: false }));
  }
});

// Adds upcoming copies of weekly repeats. Only saves when something new was added.
export function ensureSeries() {
  const today = todayKey();
  const s = getStudy();
  const target = addDays(today, HORIZON);
  const behind = s.series.some((r) => (r.filledTo || '') < (r.until && r.until < target ? r.until : target));
  if (!behind) return;
  change((st) => { for (const r of st.series) fillSeries(st, r, today); }, false);
}

// ---------- class and lab times ----------
// Everything meeting on one day, earliest first: [{ course, meeting }]
export function meetingsOn(s, day) {
  const dow = dayOfWeek(day);
  const out = [];
  for (const course of s.courses) for (const m of course.meetings ?? []) if (m.days.includes(dow)) out.push({ course, meeting: m });
  return out.sort((a, b) => a.meeting.start.localeCompare(b.meeting.start));
}

export const timeRange = (m) => (m.end ? `${formatHM(m.start)} to ${formatHM(m.end)}` : formatHM(m.start));

// ---------- your own calendar blocks (work, appointments, study time, other) ----------
// { id, kind, title, start: 'HH:MM', end: 'HH:MM', place,
//   weekly: days: [0-6], from, until    one-time: dates: ['YYYY-MM-DD', ...] (date = the first one) }
export const BLOCK_KINDS = {
  study:       { label: 'Study time' },
  work:        { label: 'Work' },
  appointment: { label: 'Appointment' },
  other:       { label: 'Other' },
};

export const saveBlock = (b) => change((s) => {
  const dates = b.weekly ? [] : [...new Set((b.dates?.length ? b.dates : [b.date]).filter(Boolean))].sort();
  const clean = {
    id: b.id || newId(), kind: BLOCK_KINDS[b.kind] ? b.kind : 'other', title: (b.title || '').trim(),
    start: b.start, end: b.end || '', place: (b.place || '').trim(),
    days: b.weekly ? [...(b.days || [])].sort() : [], from: b.weekly ? (b.from || '') : '', until: b.weekly ? (b.until || '') : '',
    date: dates[0] || '', dates,
  };
  const i = s.blocks.findIndex((x) => x.id === clean.id);
  if (i >= 0) s.blocks[i] = clean; else s.blocks.push(clean);
  return clean;
});

export const deleteBlock = (id) => change((s) => { s.blocks = s.blocks.filter((b) => b.id !== id); });

const blockOn = (b, day) => (b.days?.length
  ? b.days.includes(dayOfWeek(day)) && (!b.from || day >= b.from) && (!b.until || day <= b.until)
  : (b.dates?.length ? b.dates.includes(day) : b.date === day));

// When an exam with a start time sits on the calendar: start to end (1 hour if no end time).
export function examWindow(t) {
  if (t.type !== 'exam' || !t.time) return null;
  return { start: t.time, end: t.end && t.end > t.time ? t.end : toHM(Math.min(toMin(t.time) + 60, 23 * 60 + 59)) };
}

// An exam takes over its time slot: anything else in that slot is cut around it or hidden.
function cutForExams(items) {
  const byStart = (a, b) => a.start.localeCompare(b.start);
  const exams = items.filter((i) => i.kind === 'exam');
  if (!exams.length) return items.sort(byStart);
  const wins = exams.map((e) => [toMin(e.start), e.end ? toMin(e.end) : toMin(e.start) + 60]);
  const out = [...exams];
  for (const it of items) {
    if (it.kind === 'exam') continue;
    const orig = [toMin(it.start), it.end ? toMin(it.end) : toMin(it.start) + 60];
    let segs = [orig];
    for (const [a, b] of wins) {
      segs = segs.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([p, q]) => q - p >= 5)));
    }
    if (segs.length === 1 && segs[0][0] === orig[0] && segs[0][1] === orig[1]) out.push(it);
    else for (const [x, y] of segs) out.push({ ...it, start: toHM(x), end: toHM(y), cut: true });
  }
  return out.sort(byStart);
}

// Everything on one day's calendar, earliest first: classes, labs, your own blocks and timed exams.
// [{ kind: 'class'|'lab'|'exam'|'study'|'work'|'appointment'|'other', title, start, end, place, color, course?, meeting?, block?, task? }]
export function dayItems(s, day) {
  const items = meetingsOn(s, day).map(({ course, meeting }) => ({
    kind: meeting.kind, title: course.name, start: meeting.start, end: meeting.end, place: meeting.place,
    color: course.color, course, meeting,
    // Office hours are there if you want them, so they don't count as busy time.
    soft: meeting.kind === 'office' || meeting.kind === 'ta',
  }));
  for (const b of s.blocks) if (blockOn(b, day)) items.push({ kind: b.kind, title: b.title || BLOCK_KINDS[b.kind]?.label, start: b.start, end: b.end, place: b.place, block: b });
  const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
  for (const t of liveTasks(s)) {
    const w = t.due === day ? examWindow(t) : null;
    if (w) items.push({ kind: 'exam', title: t.title, start: w.start, end: w.end, place: '', color: courses[t.courseId]?.color, course: courses[t.courseId], task: t });
  }
  return cutForExams(items);
}

const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// Open stretches of at least `min` minutes between `from` and `to` on a day (things without an end count as 1 hour).
export function freeGaps(items, { from = '08:00', to = '22:00', min = 60 } = {}) {
  const busy = items.filter((i) => !i.soft).map((i) => [toMin(i.start), i.end ? toMin(i.end) : toMin(i.start) + 60]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let t = toMin(from);
  const stop = toMin(to);
  for (const [a, b] of busy) {
    if (a - t >= min && t < stop) gaps.push({ start: toHM(t), end: toHM(Math.min(a, stop)) });
    t = Math.max(t, b);
  }
  if (stop - t >= min) gaps.push({ start: toHM(t), end: toHM(stop) });
  return gaps.filter((g) => toMin(g.end) - toMin(g.start) >= min);
}

// ---------- reading a syllabus ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Picks the year that puts month/day closest to today (syllabi rarely say the year).
function nearestDate(month, day, today = todayKey()) {
  const y = Number(today.slice(0, 4));
  const options = [y - 1, y, y + 1].map((yy) => new Date(yy, month - 1, day)).filter((d) => d.getMonth() === month - 1);
  if (!options.length) return null;
  const now = fromKey(today).getTime();
  options.sort((a, b) => Math.abs(a - now) - Math.abs(b - now));
  return toKey(options[0]);
}

// Finds a date anywhere in a line: 2026-09-30, 9/30, 9/30/26, Sep 30, September 30th, 30 Sep.
export function findDate(line, today = todayKey()) {
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(line);
  if (m) return { date: toKey(new Date(+m[1], +m[2] - 1, +m[3])), match: m[0] };
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(line);
  if (m) {
    const [mo, d] = [+m[1], +m[2]];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const date = m[3] ? toKey(new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo - 1, d)) : nearestDate(mo, d, today);
      if (date) return { date, match: m[0] };
    }
  }
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(line);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) {
    const date = nearestDate(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2], today);
    if (date) return { date, match: m[0] };
  }
  m = /\b(\d{1,2})\s+([A-Za-z]{3,9})\b/.exec(line);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) {
    const date = nearestDate(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1], today);
    if (date) return { date, match: m[0] };
  }
  return null;
}

export function guessTaskType(title) {
  if (/\b(exam|midterm|final|test|quiz)\b/i.test(title)) return 'exam';
  if (/\b(read|reading|chapter|ch\.?\s*\d|pages?|pp\.)/i.test(title)) return 'reading';
  if (/\b(hw|homework|problem set|pset|p\.?set|worksheet|exercises?|webwork)\b/i.test(title)) return 'homework';
  return 'assignment';
}

// Turns pasted syllabus lines into dated items. Lines without a date are skipped.
export function parseSyllabus(text, today = todayKey()) {
  const items = [];
  let skipped = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const found = findDate(line, today);
    if (!found) { skipped++; continue; }
    const title = line.replace(found.match, ' ')
      .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b\.?,?/gi, ' ')
      .replace(/^[\s\-:,.|]+|[\s\-:,.|]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!title) { skipped++; continue; }
    items.push({ title, type: guessTaskType(title), due: found.date });
  }
  return { items, skipped };
}

// ---------- reading the planner ----------
const daysBetween = (from, to) => Math.round((fromKey(to) - fromKey(from)) / 86400000);
export const liveTasks = (s) => s.tasks.filter((t) => !t.deleted);
const byDue = (a, b) => `${a.due}T${a.time || '99'}`.localeCompare(`${b.due}T${b.time || '99'}`);

export function dueLabel(t, today = todayKey()) {
  const d = daysBetween(today, t.due);
  const time = t.time ? ` ${formatHM(t.time)}` : '';
  if (d < 0) return d === -1 ? `Yesterday${time}` : `${-d} days late`;
  if (d === 0) return `Today${time}`;
  if (d === 1) return `Tomorrow${time}`;
  if (d < 7) return `${fromKey(t.due).toLocaleDateString(undefined, { weekday: 'short' })}${time}`;
  return `${formatShort(t.due)}${time}`;
}

export function studyStatus(s, today = todayKey()) {
  const open = liveTasks(s).filter((t) => !t.done).sort(byDue);
  const overdue = open.filter((t) => t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const dueTomorrow = open.filter((t) => t.due === addDays(today, 1));
  const examsSoon = open.filter((t) => t.type === 'exam' && t.due >= today && t.due <= addDays(today, 3));
  let mood = 'happy';
  if (overdue.length) mood = 'sad';
  else if (examsSoon.length || dueToday.length) mood = 'worried';
  return { open, overdue, dueToday, dueTomorrow, examsSoon, mood };
}

// What Pip says when school is the thing that needs you most.
export function studyPipLine(st, today = todayKey()) {
  if (st.overdue.length === 1) return `${st.overdue[0].title} is overdue. Want to knock it out?`;
  if (st.overdue.length > 1) return `${st.overdue.length} things are overdue. One at a time?`;
  const exam = st.examsSoon[0];
  if (exam) {
    const d = daysBetween(today, exam.due);
    return d === 0 ? `${exam.title} is today. You've got this.` : `${exam.title} is in ${d} ${d === 1 ? 'day' : 'days'}. Study time?`;
  }
  if (st.dueToday.length === 1) return `${st.dueToday[0].title} is due today.`;
  if (st.dueToday.length > 1) return `${st.dueToday.length} things are due today.`;
  return null;
}

// The part of the planner the reminder server needs (next two weeks plus anything overdue).
export function studyForPush(data) {
  const s = forSemester(norm(data.study), data);
  const until = addDays(todayKey(), 14);
  const names = Object.fromEntries(s.courses.map((c) => [c.id, c.name]));
  return {
    tasks: liveTasks(s).filter((t) => !t.done && t.due <= until).sort(byDue).slice(0, 60)
      .map((t) => ({ id: t.id, title: t.title, type: t.type, course: names[t.courseId] || '', due: t.due, time: t.time || '' })),
    cards: cardsDueMap(data),
  };
}

// When school needs you more than the meal budget does, Pip's mood and line follow school.
const RANK = { sleeping: 0, happy: 1, eating: 1, shocked: 1, worried: 2, sad: 3 };
export function studyOverride(profile, budgetMood, today = todayKey()) {
  if (!studyNotifyPrefs(profile).pip) return null;
  const st = studyStatus(getStudy(), today);
  if (st.mood === 'happy' || (RANK[st.mood] ?? 0) <= (RANK[budgetMood] ?? 0)) return null;
  return { mood: st.mood, line: studyPipLine(st, today) };
}

// ---------- sharing your schedule with friends ----------
// You pick what friends see: for everyone, and differently for any one friend.
// The server only hands each friend the parts you allowed for them.
export const SHARE_CATS = {
  class: 'Classes and labs', exam: 'Exams', study: 'Study time', work: 'Work',
  appointment: 'Appointments', other: 'Other blocks', place: 'Locations',
};
const DEFAULT_SHARE = { class: true, exam: false, study: false, work: false, appointment: false, other: false, place: false };
const cleanShare = (v) => Object.fromEntries(Object.keys(DEFAULT_SHARE).map((k) => [k, typeof v?.[k] === 'boolean' ? v[k] : DEFAULT_SHARE[k]]));

// { all: {class, exam, ...}, people: { friendId: {class, exam, ...} } }
export function shareRulesOf(profile) {
  const r = profile?.shareRules ?? {};
  const people = {};
  for (const [id, v] of Object.entries(r.people ?? {})) if (v && typeof v === 'object') people[id] = cleanShare(v);
  return { all: cleanShare(r.all), people };
}

// What goes to the server: only the kinds at least one friend is allowed to see.
export function scheduleForFriends(data) {
  const rules = shareRulesOf(data.profile);
  const any = (cat) => rules.all[cat] || Object.values(rules.people).some((r) => r[cat]);
  const place = (p) => (any('place') && p ? { place: String(p).slice(0, 60) } : {});
  const s = forSemester(norm(data.study), data);
  const today = todayKey();
  const horizon = addDays(today, 60);
  const out = [];
  if (any('class')) {
    for (const c of s.courses) {
      for (const m of c.meetings ?? []) {
        if (!m.days?.length || !m.start || (m.kind !== 'class' && m.kind !== 'lab')) continue;
        out.push({ cat: 'class', kind: m.kind === 'lab' ? 'lab' : 'class', name: c.name, code: c.code || '', color: c.color, days: m.days, start: m.start, end: m.end || '', ...place(m.place) });
      }
    }
  }
  if (any('exam')) {
    const courses = Object.fromEntries(s.courses.map((c) => [c.id, c]));
    for (const t of liveTasks(s)) {
      const w = examWindow(t);
      if (!w || t.due < today || t.due > horizon) continue;
      const c = courses[t.courseId];
      out.push({ cat: 'exam', kind: 'exam', name: t.title, code: c?.code || c?.name || '', color: c?.color || '', dates: [t.due], start: w.start, end: w.end });
    }
  }
  for (const b of s.blocks) {
    if (!BLOCK_KINDS[b.kind] || !any(b.kind) || !b.start) continue;
    const base = { cat: b.kind, kind: b.kind, name: b.title || BLOCK_KINDS[b.kind].label, start: b.start, end: b.end || '', ...place(b.place) };
    if (b.days?.length) {
      if (b.until && b.until < today) continue;
      out.push({ ...base, days: b.days, from: b.from || '', until: b.until || '' });
    } else {
      const dates = (b.dates?.length ? b.dates : [b.date]).filter((d) => d && d >= today && d <= horizon);
      if (dates.length) out.push({ ...base, dates });
    }
  }
  return out.slice(0, 150);
}

// A friend's shared items on one day, earliest first (their exams take over their slots too).
const HM = /^\d\d:\d\d$/;
const SHARED_KINDS = ['class', 'lab', 'exam', 'study', 'work', 'appointment', 'other'];
const sharedDay = (m, day) => (Array.isArray(m.dates) && m.dates.length
  ? m.dates.includes(day)
  : Array.isArray(m.days) && m.days.includes(dayOfWeek(day)) && (!m.from || day >= m.from) && (!m.until || day <= m.until));
export function sharedOn(items, day) {
  const list = (Array.isArray(items) ? items : [])
    .filter((m) => m && typeof m === 'object' && HM.test(m.start) && sharedDay(m, day))
    .map((m) => ({
      kind: SHARED_KINDS.includes(m.kind) ? m.kind : 'other', name: String(m.name || 'Busy'), title: String(m.name || 'Busy'),
      code: String(m.code || ''), color: m.color, start: m.start, end: HM.test(m.end) ? m.end : '',
      place: typeof m.place === 'string' ? m.place : '',
    }));
  return cutForExams(list);
}

// Where someone is at `hm` given that day's items: { busy, item, until }.
export function nowFor(items, hm) {
  const cur = toMin(hm);
  const endOf = (i) => (i.end ? toMin(i.end) : toMin(i.start) + 60);
  const on = items.find((i) => toMin(i.start) <= cur && cur < endOf(i));
  if (on) return { busy: true, item: on, until: toHM(endOf(on)) };
  const next = items.find((i) => toMin(i.start) > cur);
  return { busy: false, item: null, until: next ? next.start : '' };
}
