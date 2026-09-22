// Study planner data: courses, tasks (homework, assignments, exams, readings) and weekly repeats.
// Saved with the rest of your pond and synced as one piece called "study".
import { readAll, writeAll, newId } from './db.js';
import { todayKey, addDays, dayOfWeek, fromKey, formatShort, formatHM } from '../core/dates.js';

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
  pip: true,           // Pip's mood reacts to homework and exams
};

const blank = () => ({ courses: [], tasks: [], series: [] });

function norm(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return blank();
  return {
    courses: Array.isArray(s.courses) ? s.courses : [],
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    series: Array.isArray(s.series) ? s.series : [],
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