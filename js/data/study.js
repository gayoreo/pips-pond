// Study planner data: courses, tasks (homework, assignments, exams, readings) and weekly repeats.
// Saved with the rest of your pond and synced as one piece called "study".
import { readAll, writeAll, newId } from './db.js';
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

export const getStudy = () => norm(readAll().study);

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
export const addCourse = ({ name, color }) => change((s) => {
  const course = { id: newId(), name: name.trim(), color: color || COURSE_COLORS[s.courses.length % COURSE_COLORS.length] };
  s.courses.push(course);
  return course;
});

export const updateCourse = (id, patch) => change((s) => {
  const c = s.courses.find((x) => x.id === id);
  if (c) Object.assign(c, patch);
});

// Saves a whole course from the setup screens: name, code, color, class and lab times,
// plus any new exams, assignments and readings. Returns the course.
// meetings: [{ kind: 'class' | 'lab', days: [0-6], start: 'HH:MM', end: 'HH:MM', place }]
export const saveCourse = ({ id, name, code = '', color, meetings = [] }, newTasks = []) => change((s) => {
  let course = id ? s.courses.find((c) => c.id === id) : null;
  const clean = meetings
    .filter((m) => m.days?.length && m.start)
    .map((m) => ({ id: m.id || newId(), kind: m.kind === 'lab' ? 'lab' : 'class', days: [...m.days].sort(), start: m.start, end: m.end || '', place: (m.place || '').trim() }));
  if (course) Object.assign(course, { name: name.trim(), code: code.trim(), color: color || course.color, meetings: clean });
  else {
    course = { id: newId(), name: name.trim(), code: code.trim(), color: color || COURSE_COLORS[s.courses.length % COURSE_COLORS.length], meetings: clean };
    s.courses.push(course);
  }
  for (const t of newTasks) {
    s.tasks.push({
      id: newId(), courseId: course.id, title: t.title.trim(), type: t.type, due: t.due, time: t.time || '',
      done: false, doneAt: '', checklist: [], notes: '',
    });
  }
  return course;
});

export const deleteCourse = (id) => change((s) => {
  s.courses = s.courses.filter((c) => c.id !== id);
  for (const t of s.tasks) if (t.courseId === id) t.courseId = '';
  for (const r of s.series) if (r.courseId === id) r.courseId = '';
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
// { id, kind, title, start: 'HH:MM', end: 'HH:MM', place, days: [0-6] for weekly, date: 'YYYY-MM-DD' for one-time, until }
export const BLOCK_KINDS = {
  study:       { label: 'Study time' },
  work:        { label: 'Work' },
  appointment: { label: 'Appointment' },
  other:       { label: 'Other' },
};

export const saveBlock = (b) => change((s) => {
  const clean = {
    id: b.id || newId(), kind: BLOCK_KINDS[b.kind] ? b.kind : 'other', title: (b.title || '').trim(),
    start: b.start, end: b.end || '', place: (b.place || '').trim(),
    days: b.weekly ? [...(b.days || [])].sort() : [], date: b.weekly ? '' : b.date, until: b.weekly ? (b.until || '') : '',
  };
  const i = s.blocks.findIndex((x) => x.id === clean.id);
  if (i >= 0) s.blocks[i] = clean; else s.blocks.push(clean);
  return clean;
});

export const deleteBlock = (id) => change((s) => { s.blocks = s.blocks.filter((b) => b.id !== id); });

const blockOn = (b, day) => (b.days?.length ? b.days.includes(dayOfWeek(day)) && (!b.until || day <= b.until) : b.date === day);

// Everything on one day's calendar, earliest first: classes, labs and your own blocks.
// [{ kind: 'class'|'lab'|'study'|'work'|'appointment'|'other', title, start, end, place, color, course?, meeting?, block? }]
export function dayItems(s, day) {
  const items = meetingsOn(s, day).map(({ course, meeting }) => ({
    kind: meeting.kind, title: course.name, start: meeting.start, end: meeting.end, place: meeting.place,
    color: course.color, course, meeting,
  }));
  for (const b of s.blocks) if (blockOn(b, day)) items.push({ kind: b.kind, title: b.title || BLOCK_KINDS[b.kind]?.label, start: b.start, end: b.end, place: b.place, block: b });
  return items.sort((a, b) => a.start.localeCompare(b.start));
}

const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// Open stretches of at least `min` minutes between `from` and `to` on a day (things without an end count as 1 hour).
export function freeGaps(items, { from = '08:00', to = '22:00', min = 60 } = {}) {
  const busy = items.map((i) => [toMin(i.start), i.end ? toMin(i.end) : toMin(i.start) + 60]).sort((a, b) => a[0] - b[0]);
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
  const s = norm(data.study);
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

// ---------- sharing your class schedule with friends ----------
// Only class and lab times go out: course name, code, color, days and times.
// Places, homework and your own calendar blocks never leave your phone.
export function scheduleForFriends(data) {
  const s = norm(data.study);
  const out = [];
  for (const c of s.courses) {
    for (const m of c.meetings ?? []) {
      if (!m.days?.length || !m.start) continue;
      out.push({ name: c.name, code: c.code || '', color: c.color, kind: m.kind === 'lab' ? 'lab' : 'class', days: m.days, start: m.start, end: m.end || '' });
    }
  }
  return out.slice(0, 80);
}

// A friend's shared classes on one day, earliest first.
export function sharedOn(meetings, day) {
  const dow = dayOfWeek(day);
  return (Array.isArray(meetings) ? meetings : [])
    .filter((m) => Array.isArray(m.days) && m.days.includes(dow) && /^\d\d:\d\d$/.test(m.start))
    .map((m) => ({ kind: m.kind === 'lab' ? 'lab' : 'class', name: String(m.name || 'Class'), code: String(m.code || ''), color: m.color, start: m.start, end: /^\d\d:\d\d$/.test(m.end) ? m.end : '' }))
    .sort((a, b) => a.start.localeCompare(b.start));
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
