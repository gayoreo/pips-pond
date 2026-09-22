// One course's page: current grade and letter, grade categories and scores, extra credit,
// "what do I need", scores waiting to be entered, plus the course's class times, upcoming work and decks.
import {
  getStudy, saveGrading, saveGradeItem, deleteGradeItem, saveExtra, deleteExtra, needsScore, skipScore,
  liveTasks, dueLabel, timeRange,
} from '../data/study.js';
import { getDecks, dueCards } from '../data/decks.js';
import {
  courseGrade, gradingOf, scoreNeeded, letterFor, fmtPct, GRADE_TEMPLATES, SCALE_PM, SCALE_PLAIN,
} from '../core/grades.js';
import { todayKey } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';
import { openSheet } from '../ui/sheet.js';
import { beginCourseSetup } from './courseSetup.js';
import { openTaskSheet } from './study.js';
import { openDeck } from './decks.js';

const COURSE_KEY = 'course:id';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const state = { target: '', item: '' }; // "what do I need" picks, remembered while the page is open

export function openCourse(id) {
  try { sessionStorage.setItem(COURSE_KEY, id); } catch { /* ignore */ }
  state.target = '';
  state.item = '';
  location.hash = '#/course';
}
const courseId = () => { try { return sessionStorage.getItem(COURSE_KEY) || ''; } catch { return ''; } };
const backToGrades = () => { try { sessionStorage.setItem('study:mode', 'grades'); } catch { /* ignore */ } location.hash = '#/study'; };

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const scoreText = (it) => {
  if (it.status === 'excused') return 'excused';
  if (it.status === 'pending' || num(it.earned) === null) return num(it.possible) ? `-- / ${num(it.possible)}` : 'not graded yet';
  const extra = num(it.extra) ? ` +${num(it.extra)}` : '';
  return `${num(it.earned)}${extra} / ${num(it.possible)}`;
};
const itemPct = (it) => (it.status === 'graded' && num(it.earned) !== null && num(it.possible) > 0
  ? fmtPct(Math.round(((num(it.earned) + (num(it.extra) ?? 0)) / num(it.possible)) * 1000) / 10) : '');

// Best guess at which category a finished task's score belongs in.
export function guessCategory(course, task) {
  const cats = gradingOf(course).categories.filter((c) => !c.bonus);
  const text = `${task?.title ?? ''} ${task?.type ?? ''}`;
  const tests = [
    [/quiz/i, /quiz/i], [/final|midterm|exam|test/i, /exam|test|midterm/i], [/lab/i, /lab/i],
    [/project/i, /project/i], [/paper|essay|writing/i, /paper|essay|writing/i],
    [/homework|hw|problem|pset/i, /home ?work|hw|problem|assign/i], [/assign/i, /assign|home ?work/i],
  ];
  for (const [inTask, inCat] of tests) {
    if (!inTask.test(text)) continue;
    const hit = cats.find((c) => inCat.test(c.name));
    if (hit) return hit.id;
  }
  return cats[0]?.id ?? '';
}

// ---------- the page ----------
export async function renderCourse(root) {
  const s = getStudy();
  const course = s.courses.find((c) => c.id === courseId());
  if (!course) { backToGrades(); return; }
  const g = gradingOf(course);
  const result = courseGrade(course);
  const items = course.grades ?? [];
  const today = todayKey();
  const waiting = needsScore(s).filter((t) => t.courseId === course.id);
  const upcoming = liveTasks(s).filter((t) => t.courseId === course.id && !t.done).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  const decks = getDecks().filter((d) => d.courseId === course.id);
  const pending = items.filter((it) => (it.status === 'pending' || num(it.earned) === null) && it.status !== 'excused' && num(it.possible) > 0);
  const scale = [...(g.scale?.length ? g.scale : SCALE_PM)].sort((a, b) => b.min - a.min);

  const catCard = (c) => {
    const r = result.cats[c.id] ?? { pct: null, dropped: [] };
    const list = items.filter((it) => it.catId === c.id);
    const tags = [
      g.mode === 'weighted' && !c.bonus ? `${num(c.weight) ?? 0}%` : '',
      c.bonus ? 'extra credit' : '',
      num(c.drop) ? `drops lowest ${num(c.drop)}` : '',
      g.replaceLowest && g.examCat === c.id ? 'final replaces lowest' : '',
    ].filter(Boolean).join(' · ');
    return `
    <section class="card grade-cat">
      <div class="grade-cat__head">
        <h2 class="card__title">${esc(c.name)} ${tags ? `<span class="muted">${tags}</span>` : ''}</h2>
        <span class="grade-cat__pct">${r.pct === null ? '--' : fmtPct(Math.round(r.pct * 1000) / 10)}</span>
      </div>
      ${list.length ? `<ul class="grade-items">${list.map((it) => `
        <li><button type="button" data-item="${esc(it.id)}" class="${it.status === 'excused' ? 'is-excused' : ''}${r.dropped.includes(it.id) ? ' is-dropped' : ''}">
          <span class="grade-items__name">${esc(it.name)}${it.isFinal ? ' <span class="muted">final</span>' : ''}${r.dropped.includes(it.id) ? ' <span class="muted">dropped</span>' : ''}</span>
          <span class="grade-items__score">${esc(scoreText(it))}</span>
          <span class="grade-items__pct">${itemPct(it)}</span>
        </button></li>`).join('')}</ul>` : '<p class="card__hint">Nothing here yet.</p>'}
      <button type="button" class="btn-plain" data-add-item="${esc(c.id)}">+ add a score</button>
    </section>`;
  };

  let need = '';
  if (pending.length && !g.passFail) {
    const target = state.target
      || (scale.some((x) => x.letter === result.letter && x.min > 0) ? result.letter : scale[0].letter);
    const item = pending.find((it) => it.id === state.item) ?? pending.find((it) => it.isFinal) ?? pending[pending.length - 1];
    const min = scale.find((x) => x.letter === target)?.min ?? 90;
    const r = scoreNeeded(course, item.id, min);
    const answer = !r ? '' : r.already ? `You’ll get at least a ${esc(target)} even with a 0 on ${esc(item.name)}.`
      : r.impossible ? `A ${esc(target)} is out of reach on ${esc(item.name)} alone${r.need ? ` (it would take ${r.need}%)` : ''}.`
      : `You need <b>${r.need}%</b> on ${esc(item.name)} to get a ${esc(target)}.`;
    need = `
    <section class="card">
      <h2 class="card__title">What do I need?</h2>
      <div class="grid-2">
        <label class="field">For a<select data-target>${scale.filter((x) => x.min > 0).map((x) => `<option${x.letter === target ? ' selected' : ''}>${esc(x.letter)}</option>`).join('')}</select></label>
        <label class="field">On<select data-need-item>${pending.map((it) => `<option value="${esc(it.id)}"${it.id === item.id ? ' selected' : ''}>${esc(it.name)}</option>`).join('')}</select></label>
      </div>
      <p class="need-answer">${answer}</p>
      <p class="card__hint">Uses everything graded so far. Add upcoming exams as “not graded yet” to plan for them.</p>
    </section>`;
  }

  const meets = course.meetings ?? [];
  root.innerHTML = `
  <div class="course-page stack" style="--course:${course.color}">
    <div class="sheet__head">
      <button type="button" class="btn-plain btn-plain--muted" data-back>back</button>
      <h1 class="page-title">${esc(course.name)}</h1>
      <span class="spacer"></span>
    </div>

    <section class="card grade-hero">
      <div>
        <p class="grade-hero__pct">${fmtPct(result.pct)}</p>
        <p class="muted">${course.code ? `${esc(course.code)} · ` : ''}${g.passFail ? 'pass/fail' : `${num(g.credits) ?? 0} ${num(g.credits) === 1 ? 'credit' : 'credits'}`}${g.mode === 'points' ? ' · total points' : ' · weighted'}</p>
      </div>
      <p class="grade-hero__letter">${esc(result.letter || '--')}</p>
    </section>
    <div class="row">
      <button type="button" class="btn-sketch btn-sketch--small" data-grading>grade setup</button>
      <button type="button" class="btn-sketch btn-sketch--small" data-edit-course>class times &amp; exams</button>
    </div>

    ${waiting.length ? `
    <section class="card">
      <h2 class="card__title">Needs a score</h2>
      <ul class="needs-list">${waiting.map((t) => `
        <li><span>${esc(t.title)}</span>
          <button type="button" class="btn-plain" data-score-task="${esc(t.id)}">add score</button>
          <button type="button" class="btn-plain btn-plain--muted" data-skip-task="${esc(t.id)}">skip</button></li>`).join('')}</ul>
    </section>` : ''}

    ${g.categories.length ? `
      ${need}
      ${g.categories.map(catCard).join('')}
      <section class="card">
        <h2 class="card__title">Extra credit on the course</h2>
        ${(course.extras ?? []).length ? `<ul class="grade-items">${course.extras.map((x) => `
          <li><button type="button" data-extra="${esc(x.id)}">
            <span class="grade-items__name">${esc(x.note || 'Extra credit')}</span>
            <span class="grade-items__score">+${num(x.amount) ?? 0} ${x.kind === 'percent' ? '% to grade' : 'points'}</span>
          </button></li>`).join('')}</ul>` : '<p class="card__hint">Bonus points or a curve for the whole course. Extra credit on one assignment goes on that score instead.</p>'}
        <button type="button" class="btn-plain" data-add-extra>+ add extra credit</button>
      </section>` : `
    <section class="card">
      <h2 class="card__title">How is this class graded?</h2>
      <p class="card__hint">Pick a starting point. You can rename, reweight and add categories after.</p>
      <div class="stack">
        <button type="button" class="btn-sketch" data-template="weighted">Weighted categories (like Homework 20%, Exams 60%)</button>
        <button type="button" class="btn-sketch" data-template="points">Total points (like 850 / 1000)</button>
      </div>
    </section>`}

    <section class="card">
      <h2 class="card__title">This class</h2>
      ${meets.length ? `<ul class="plain-list">${meets.map((m) => `<li>${m.kind === 'lab' ? 'Lab' : 'Class'}: ${m.days.map((d) => DAYS[d]).join(', ')} ${esc(timeRange(m))}${m.place ? ` · ${esc(m.place)}` : ''}</li>`).join('')}</ul>` : '<p class="card__hint">No class times yet.</p>'}
      ${upcoming.length ? `<p class="fw-sub">Coming up</p><ul class="plain-list">${upcoming.map((t) => `<li><button type="button" class="btn-plain" data-task="${esc(t.id)}">${esc(t.title)}</button> <span class="muted">${esc(dueLabel(t, today))}</span></li>`).join('')}</ul>` : ''}
      ${decks.length ? `<p class="fw-sub">Decks</p><ul class="plain-list">${decks.map((d) => `<li><button type="button" class="btn-plain" data-deck="${esc(d.id)}">${esc(d.name)}</button> <span class="muted">${dueCards(d).length} due</span></li>`).join('')}</ul>` : ''}
    </section>
  </div>`;

  const page = root.querySelector('.course-page');
  page.addEventListener('change', (e) => {
    if (e.target.matches('[data-target]')) { state.target = e.target.value; renderCourse(root); }
    if (e.target.matches('[data-need-item]')) { state.item = e.target.value; renderCourse(root); }
  });
  page.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-back]')) return backToGrades();
    if (t.closest('[data-edit-course]')) return beginCourseSetup(course.id);
    if (t.closest('[data-grading]')) return openGradingSheet(course);
    const tpl = t.closest('[data-template]');
    if (tpl) {
      saveGrading(course.id, { ...GRADE_TEMPLATES[tpl.dataset.template](), scale: g.scale });
      play('pop');
      return toast('Set up. Tap “grade setup” to change names and weights.');
    }
    const add = t.closest('[data-add-item]');
    if (add) return openItemSheet(course, { catId: add.dataset.addItem });
    const item = t.closest('[data-item]');
    if (item) return openItemSheet(course, items.find((x) => x.id === item.dataset.item));
    const sc = t.closest('[data-score-task]');
    if (sc) return scoreTask(course, s.tasks.find((x) => x.id === sc.dataset.scoreTask));
    const sk = t.closest('[data-skip-task]');
    if (sk) { skipScore(sk.dataset.skipTask); return toast('Skipped. It won’t ask again.'); }
    if (t.closest('[data-add-extra]')) return openExtraSheet(course, null);
    const ex = t.closest('[data-extra]');
    if (ex) return openExtraSheet(course, (course.extras ?? []).find((x) => x.id === ex.dataset.extra));
    const task = t.closest('[data-task]');
    if (task) return openTaskSheet(s.tasks.find((x) => x.id === task.dataset.task));
    const deck = t.closest('[data-deck]');
    if (deck) return openDeck(deck.dataset.deck);
    return undefined;
  });
}

// Opens the score sheet for a finished planner task (from "needs a score").
export function scoreTask(course, task) {
  if (!task) return;
  if (!gradingOf(course).categories.length) {
    saveGrading(course.id, { ...GRADE_TEMPLATES.weighted(), scale: gradingOf(course).scale });
    toast('Gave this course a starting grade setup. Change it any time in “grade setup”.', 3500);
  }
  const fresh = getStudy().courses.find((c) => c.id === course.id) ?? course;
  openItemSheet(fresh, {
    name: task.title, taskId: task.id, catId: guessCategory(fresh, task),
    isFinal: task.type === 'exam' && /final/i.test(task.title),
  });
}

// ---------- add / edit a score ----------
export function openItemSheet(course, item) {
  const g = gradingOf(course);
  const editing = Boolean(item?.id);
  const it = { name: '', catId: g.categories[0]?.id ?? '', earned: '', possible: 100, status: 'graded', extra: '', isFinal: false, ...(item ?? {}) };
  const html = `
    <label class="field">Name<input name="name" maxlength="60" autocomplete="off" value="${esc(it.name)}" placeholder="Quiz 3"></label>
    <label class="field">Category<select name="cat">${g.categories.map((c) => `<option value="${esc(c.id)}"${c.id === it.catId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="seg seg--3" role="group" aria-label="Status">
      ${[['graded', 'Graded'], ['pending', 'Not graded yet'], ['excused', 'Excused']].map(([k, label]) => `<button type="button" data-status="${k}" aria-pressed="${it.status === k}">${label}</button>`).join('')}
    </div>
    <div class="grid-2">
      <label class="field" data-earned-row${it.status === 'graded' ? '' : ' hidden'}>Score<input name="earned" inputmode="decimal" autocomplete="off" value="${esc(String(it.earned ?? ''))}" placeholder="18 or 90%"></label>
      <label class="field">Out of<input name="possible" inputmode="decimal" autocomplete="off" value="${esc(String(it.possible ?? ''))}"></label>
    </div>
    <label class="field" data-extra-row${it.status === 'graded' ? '' : ' hidden'}><span class="field__label">Extra credit on this one <span class="muted">(points, optional)</span></span><input name="extra" inputmode="decimal" autocomplete="off" value="${esc(String(it.extra ?? ''))}"></label>
    ${g.replaceLowest ? `<label class="row"><span>This is the final exam</span><input type="checkbox" class="switch" name="isFinal"${it.isFinal ? ' checked' : ''}></label>` : ''}
    <p class="card__hint">Type a percent like 90% and it’s filled in out of 100. Excused scores don’t count. “Not graded yet” is for planning with “What do I need?”.</p>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>${editing ? 'Save' : 'Add score'}</button>
    ${editing ? '<button type="button" class="btn-plain btn-plain--danger" data-delete>delete</button>' : ''}`;

  openSheet(editing ? 'Edit score' : 'Add a score', html, (sheet, close) => {
    const f = (n) => sheet.querySelector(`[name="${n}"]`);
    let status = it.status;
    if (!editing) (f('name').value ? f('earned') : f('name')).focus();
    sheet.addEventListener('click', (e) => {
      const st = e.target.closest('[data-status]');
      if (st) {
        status = st.dataset.status;
        sheet.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b === st)));
        sheet.querySelector('[data-earned-row]').hidden = status !== 'graded';
        sheet.querySelector('[data-extra-row]').hidden = status !== 'graded';
        return;
      }
      if (e.target.closest('[data-delete]')) {
        if (!confirm(`Delete ${it.name}?`)) return;
        deleteGradeItem(course.id, it.id);
        close();
        toast('Deleted.');
        return;
      }
      if (!e.target.closest('[data-save]')) return;
      let earned = f('earned').value.trim();
      let possible = f('possible').value.trim();
      if (/%$/.test(earned)) { earned = earned.slice(0, -1).trim(); possible = '100'; }
      const ok = (v) => v === '' || !Number.isNaN(Number(v));
      if (!f('name').value.trim()) { toast('Give it a name.'); return; }
      if (!ok(earned) || !ok(possible) || !ok(f('extra').value.trim())) { toast('Scores need to be numbers.'); return; }
      if (status === 'graded' && (earned === '' || !(Number(possible) > 0))) { toast('Type the score and what it’s out of.'); return; }
      if (status === 'pending' && !(Number(possible) > 0)) { toast('Type what it’s out of, so it can be planned for.'); return; }
      saveGradeItem(course.id, {
        ...it, name: f('name').value, catId: f('cat').value, status,
        earned: status === 'graded' ? Number(earned) : '', possible: possible === '' ? '' : Number(possible),
        extra: status === 'graded' && f('extra').value.trim() !== '' ? Number(f('extra').value) : '',
        isFinal: Boolean(f('isFinal')?.checked),
      });
      close();
      play('pop');
      toast(editing ? 'Saved.' : 'Score added.');
    });
  });
}

// ---------- course-wide extra credit ----------
function openExtraSheet(course, extra) {
  const editing = Boolean(extra);
  const x = { kind: 'points', amount: '', note: '', ...(extra ?? {}) };
  const html = `
    <div class="seg seg--2" role="group" aria-label="Kind">
      <button type="button" data-kind="points" aria-pressed="${x.kind === 'points'}">Points on the total</button>
      <button type="button" data-kind="percent" aria-pressed="${x.kind === 'percent'}">Percent on the grade</button>
    </div>
    <label class="field">How much<input name="amount" inputmode="decimal" autocomplete="off" value="${esc(String(x.amount))}" placeholder="2"></label>
    <label class="field"><span class="field__label">What for <span class="muted">(optional)</span></span><input name="note" maxlength="60" autocomplete="off" value="${esc(x.note)}" placeholder="Curve, survey bonus"></label>
    <p class="card__hint">Points on the total: +2 turns 80/100 into 82/100. Percent on the grade: +2 turns 85% into 87%. On a weighted course, both add straight to your percent.</p>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>${editing ? 'Save' : 'Add'}</button>
    ${editing ? '<button type="button" class="btn-plain btn-plain--danger" data-delete>delete</button>' : ''}`;
  openSheet('Extra credit', html, (sheet, close) => {
    let kind = x.kind;
    sheet.addEventListener('click', (e) => {
      const k = e.target.closest('[data-kind]');
      if (k) { kind = k.dataset.kind; sheet.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === k))); return; }
      if (e.target.closest('[data-delete]')) { deleteExtra(course.id, x.id); close(); toast('Deleted.'); return; }
      if (!e.target.closest('[data-save]')) return;
      const amount = sheet.querySelector('[name="amount"]').value.trim();
      if (amount === '' || Number.isNaN(Number(amount))) { toast('Type a number.'); return; }
      saveExtra(course.id, { ...x, kind, amount: Number(amount), note: sheet.querySelector('[name="note"]').value.trim() });
      close();
      play('pop');
    });
  });
}

// ---------- grade setup ----------
function openGradingSheet(course) {
  const g = gradingOf(course);
  const d = {
    mode: g.mode,
    categories: g.categories.map((c) => ({ ...c })),
    scale: (g.scale?.length ? g.scale : SCALE_PM).map((x) => ({ ...x })),
  };
  const catRows = () => d.categories.map((c, i) => `
    <div class="grade-row" data-cat="${i}">
      <input data-c="name" maxlength="40" value="${esc(c.name)}" aria-label="Category name">
      <input data-c="weight" inputmode="decimal" value="${esc(String(c.weight ?? ''))}" aria-label="Weight percent" placeholder="%" ${d.mode === 'weighted' ? '' : 'hidden'}>
      <input data-c="drop" inputmode="numeric" value="${esc(String(c.drop ?? ''))}" aria-label="Drop lowest" placeholder="drop">
      <label class="grade-row__bonus"><input type="checkbox" data-c="bonus"${c.bonus ? ' checked' : ''}> extra</label>
      <button type="button" class="btn-plain btn-plain--danger" data-rm-cat="${i}" aria-label="Remove ${esc(c.name)}">✕</button>
    </div>`).join('');
  const scaleRows = () => d.scale.map((x, i) => `
    <div class="grade-row grade-row--scale" data-scale="${i}">
      <input data-s="letter" maxlength="3" value="${esc(x.letter)}" aria-label="Letter">
      <span>at least</span>
      <input data-s="min" inputmode="decimal" value="${esc(String(x.min))}" aria-label="Minimum percent">
      <span>%</span>
      <button type="button" class="btn-plain btn-plain--danger" data-rm-scale="${i}" aria-label="Remove ${esc(x.letter)}">✕</button>
    </div>`).join('');
  const weightNote = () => {
    if (d.mode !== 'weighted') return '';
    const sum = d.categories.filter((c) => !c.bonus).reduce((s, c) => s + (Number(c.weight) || 0), 0);
    return sum === 100 ? 'Weights add up to 100%.' : `Weights add up to ${sum}%. They usually total 100%.`;
  };

  const html = `
    <div class="seg seg--2" role="group" aria-label="Grading">
      <button type="button" data-mode="weighted" aria-pressed="${d.mode === 'weighted'}">Weighted</button>
      <button type="button" data-mode="points" aria-pressed="${d.mode === 'points'}">Total points</button>
    </div>
    <p class="field">Categories</p>
    <p class="card__hint">Name${d.mode === 'weighted' ? ', weight %' : ''}, how many lowest scores to drop, and whether it’s an extra credit category.</p>
    <div class="stack" data-cats>${catRows()}</div>
    <p class="card__hint" data-weight-note>${weightNote()}</p>
    <button type="button" class="btn-plain" data-add-cat>+ add a category</button>

    <label class="row"><span>Final exam replaces the lowest exam</span><input type="checkbox" class="switch" name="replaceLowest"${g.replaceLowest ? ' checked' : ''}></label>
    <label class="field" data-exam-cat${g.replaceLowest ? '' : ' hidden'}>Exams are in<select name="examCat">${d.categories.map((c) => `<option value="${esc(c.id || '')}"${c.id === g.examCat ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>

    <div class="grid-2">
      <label class="field">Credits<input name="credits" inputmode="decimal" value="${esc(String(g.credits ?? 3))}"></label>
      <label class="field" data-pass-min${g.passFail ? '' : ' hidden'}>Pass at<input name="passMin" inputmode="decimal" value="${esc(String(g.passMin ?? 70))}"></label>
    </div>
    <label class="row"><span>Pass / fail (not in GPA)</span><input type="checkbox" class="switch" name="passFail"${g.passFail ? ' checked' : ''}></label>

    <p class="field">Letter grades for this class</p>
    <div class="row">
      <button type="button" class="btn-plain" data-preset="pm">A, A-, B+ …</button>
      <button type="button" class="btn-plain" data-preset="plain">A, B, C only</button>
    </div>
    <div class="stack" data-scale-rows>${scaleRows()}</div>
    <button type="button" class="btn-plain" data-add-scale>+ add a letter</button>
    <p class="card__hint">What each letter is worth for GPA is set once for your school in GPA settings.</p>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>Save</button>`;

  openSheet('Grade setup', html, (sheet, close) => {
    const q = (sel) => sheet.querySelector(sel);
    const readRows = () => {
      sheet.querySelectorAll('[data-cat]').forEach((row) => {
        const c = d.categories[Number(row.dataset.cat)];
        c.name = row.querySelector('[data-c="name"]').value;
        c.weight = row.querySelector('[data-c="weight"]').value === '' ? '' : Number(row.querySelector('[data-c="weight"]').value);
        c.drop = row.querySelector('[data-c="drop"]').value === '' ? '' : Number(row.querySelector('[data-c="drop"]').value);
        c.bonus = row.querySelector('[data-c="bonus"]').checked;
      });
      sheet.querySelectorAll('[data-scale]').forEach((row) => {
        const x = d.scale[Number(row.dataset.scale)];
        x.letter = row.querySelector('[data-s="letter"]').value.trim();
        x.min = Number(row.querySelector('[data-s="min"]').value);
      });
    };
    const redraw = () => {
      q('[data-cats]').innerHTML = catRows();
      q('[data-scale-rows]').innerHTML = scaleRows();
      q('[data-weight-note]').textContent = weightNote();
    };
    sheet.addEventListener('input', () => { readRows(); q('[data-weight-note]').textContent = weightNote(); });
    sheet.addEventListener('change', (e) => {
      if (e.target.name === 'replaceLowest') q('[data-exam-cat]').hidden = !e.target.checked;
      if (e.target.name === 'passFail') q('[data-pass-min]').hidden = !e.target.checked;
    });
    sheet.addEventListener('click', (e) => {
      const t = e.target;
      const mode = t.closest('[data-mode]');
      if (mode) {
        readRows();
        d.mode = mode.dataset.mode;
        sheet.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === mode)));
        return redraw();
      }
      if (t.closest('[data-add-cat]')) { readRows(); d.categories.push({ name: '', weight: '', drop: '' }); return redraw(); }
      const rc = t.closest('[data-rm-cat]');
      if (rc) {
        readRows();
        const c = d.categories[Number(rc.dataset.rmCat)];
        const count = (course.grades ?? []).filter((it) => it.catId === c.id).length;
        if (count && !confirm(`Remove ${c.name}? Its ${count} ${count === 1 ? 'score moves' : 'scores move'} to the first category.`)) return undefined;
        d.categories.splice(Number(rc.dataset.rmCat), 1);
        return redraw();
      }
      const preset = t.closest('[data-preset]');
      if (preset) { readRows(); d.scale = (preset.dataset.preset === 'pm' ? SCALE_PM : SCALE_PLAIN).map((x) => ({ ...x })); return redraw(); }
      if (t.closest('[data-add-scale]')) { readRows(); d.scale.push({ letter: '', min: 0 }); return redraw(); }
      const rs = t.closest('[data-rm-scale]');
      if (rs) { readRows(); d.scale.splice(Number(rs.dataset.rmScale), 1); return redraw(); }
      if (!t.closest('[data-save]')) return undefined;

      readRows();
      const cats = d.categories.filter((c) => c.name.trim());
      if (!cats.length) { toast('Add at least one category.'); return undefined; }
      const scale = d.scale.filter((x) => x.letter && !Number.isNaN(x.min));
      if (!scale.length) { toast('Add at least one letter.'); return undefined; }
      const credits = Number(q('[name="credits"]').value);
      const examSel = q('[name="examCat"]');
      const examIdx = examSel ? examSel.selectedIndex : -1;
      saveGrading(course.id, {
        mode: d.mode, categories: cats, scale,
        credits: Number.isNaN(credits) ? 0 : credits,
        passFail: q('[name="passFail"]').checked,
        passMin: Number(q('[name="passMin"]').value) || 70,
        replaceLowest: q('[name="replaceLowest"]').checked,
        examCat: examIdx >= 0 ? (d.categories[examIdx]?.id || '') : '',
      });
      // A brand-new category has no id until saved; point "exams are in" at it now that it has one.
      const saved = getStudy().courses.find((c) => c.id === course.id);
      const pick = examIdx >= 0 ? d.categories[examIdx] : null;
      if (pick && !pick.id && saved) {
        const match = saved.grading.categories.find((c) => c.name === pick.name.trim() || c.name === pick.name);
        if (match) saveGrading(course.id, { ...saved.grading, examCat: match.id });
      }
      close();
      play('pop');
      toast('Grade setup saved.');
      return undefined;
    });
  });
}

// Letter for a percent in a course (for lists elsewhere).
export const courseLetter = (course, pct) => letterFor(pct, gradingOf(course));