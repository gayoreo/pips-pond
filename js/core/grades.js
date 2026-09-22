// Grade math: weighted categories or total points, drop lowest, final replaces lowest exam,
// excused / not-graded-yet items, extra credit (points on an item, points or percent on the course,
// or a whole extra-credit category), letter cutoffs per course, and GPA from a school-wide scale.

export const SCALE_PM = [
  ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77], ['C', 73], ['C-', 70],
  ['D+', 67], ['D', 63], ['D-', 60], ['F', 0],
].map(([letter, min]) => ({ letter, min }));

export const SCALE_PLAIN = [['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]].map(([letter, min]) => ({ letter, min }));

// Letter -> grade points. School-wide; changed in GPA settings.
export const DEFAULT_GPA_SCALE = {
  'A+': 4.0, A: 4.0, 'A-': 3.67, 'B+': 3.33, B: 3.0, 'B-': 2.67, 'C+': 2.33, C: 2.0, 'C-': 1.67,
  'D+': 1.33, D: 1.0, 'D-': 0.67, F: 0,
};

export const GRADE_TEMPLATES = {
  weighted: () => ({
    mode: 'weighted',
    categories: [
      { name: 'Homework', weight: 20 }, { name: 'Quizzes', weight: 20 }, { name: 'Exams', weight: 60 },
    ],
  }),
  points: () => ({ mode: 'points', categories: [{ name: 'Assignments' }, { name: 'Quizzes'}, { name: 'Exams' }] }),
};

export const DEFAULT_GRADING = {
  mode: 'weighted', categories: [], scale: SCALE_PM, credits: 3, passFail: false, passMin: 70,
  replaceLowest: false, examCat: '',
};

export const gradingOf = (course) => ({ ...DEFAULT_GRADING, ...(course?.grading ?? {}) });

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const isGraded = (it) => it.status !== 'excused' && it.status !== 'pending' && num(it.earned) !== null && num(it.possible) > 0;
const pctOf = (e, p) => (p > 0 ? e / p : 0);

// Works out one category: returns { earned, possible, pct (0-1) or null, used: [items that counted], dropped: [ids] }.
function categoryResult(cat, items, replacement) {
  let list = items.filter(isGraded).map((it) => ({ id: it.id, earned: num(it.earned) + (num(it.extra) ?? 0), possible: num(it.possible), isFinal: Boolean(it.isFinal) }));

  // Final replaces the lowest exam in this category if it's higher.
  if (replacement && replacement.catId === cat.id) {
    const others = list.filter((x) => !x.isFinal);
    if (others.length) {
      const lowest = others.reduce((a, b) => (pctOf(a.earned, a.possible) <= pctOf(b.earned, b.possible) ? a : b));
      if (replacement.pct > pctOf(lowest.earned, lowest.possible)) {
        lowest.earned = replacement.pct * lowest.possible;
        lowest.replaced = true;
      }
    }
  }

  const dropped = [];
  const n = Math.max(0, Math.floor(num(cat.drop) ?? 0));
  if (n && list.length > n) {
    const sorted = [...list].filter((x) => !x.isFinal).sort((a, b) => pctOf(a.earned, a.possible) - pctOf(b.earned, b.possible));
    for (const x of sorted.slice(0, n)) dropped.push(x.id);
    list = list.filter((x) => !dropped.includes(x.id));
  }
  const earned = list.reduce((s, x) => s + x.earned, 0);
  const possible = list.reduce((s, x) => s + x.possible, 0);
  return { earned, possible, pct: possible > 0 ? earned / possible : null, dropped };
}

// The whole course. `override` = { itemId: earned } to try a score without saving it.
// Returns { pct (0-100+) or null, letter, cats: { catId: result }, points }
export function courseGrade(course, override = {}) {
  const g = gradingOf(course);
  const items = (course.grades ?? []).map((it) => (it.id in override ? { ...it, earned: override[it.id], status: 'graded' } : it));
  const byCat = (id) => items.filter((it) => it.catId === id);

  let replacement = null;
  if (g.replaceLowest && g.examCat) {
    const fin = items.find((it) => it.isFinal && it.catId === g.examCat && isGraded(it));
    if (fin) replacement = { catId: g.examCat, pct: (num(fin.earned) + (num(fin.extra) ?? 0)) / num(fin.possible) };
  }

  const cats = {};
  for (const c of g.categories) cats[c.id] = categoryResult(c, byCat(c.id), replacement);
  const regular = g.categories.filter((c) => !c.bonus);
  const bonus = g.categories.filter((c) => c.bonus);
  const extras = course.extras ?? [];
  const extraPoints = extras.filter((x) => x.kind === 'points').reduce((s, x) => s + (num(x.amount) ?? 0), 0);
  const extraPercent = extras.filter((x) => x.kind === 'percent').reduce((s, x) => s + (num(x.amount) ?? 0), 0);

  let pct = null;
  if (g.mode === 'points') {
    const E = regular.reduce((s, c) => s + cats[c.id].earned, 0);
    const P = regular.reduce((s, c) => s + cats[c.id].possible, 0);
    const B = bonus.reduce((s, c) => s + cats[c.id].earned, 0);
    if (P > 0) pct = ((E + B + extraPoints) / P) * 100 + extraPercent;
  } else {
    const counted = regular.filter((c) => cats[c.id].pct !== null && (num(c.weight) ?? 0) > 0);
    const W = counted.reduce((s, c) => s + num(c.weight), 0);
    if (W > 0) {
      pct = (counted.reduce((s, c) => s + num(c.weight) * cats[c.id].pct, 0) / W) * 100;
      pct += bonus.reduce((s, c) => s + (num(c.weight) ?? 0) * (cats[c.id].pct ?? 0), 0);
      pct += extraPoints + extraPercent; // on a weighted course, extra points count as percentage points
    }
  }
  if (pct !== null) pct = Math.round(pct * 100) / 100;
  return { pct, letter: letterFor(pct, g), cats };
}

export function letterFor(pct, g) {
  if (pct === null || pct === undefined) return '';
  if (g.passFail) return pct >= (num(g.passMin) ?? 70) ? 'P' : 'F';
  const scale = [...(g.scale?.length ? g.scale : SCALE_PM)].sort((a, b) => b.min - a.min);
  return (scale.find((s) => pct >= s.min) ?? scale[scale.length - 1]).letter;
}

// Score needed on one not-yet-graded item to reach `target` percent. Returns
// { need: percent on that item } or { already: true } or { impossible: true, need }.
export function scoreNeeded(course, itemId, target) {
  const it = (course.grades ?? []).find((x) => x.id === itemId);
  const possible = num(it?.possible);
  if (!possible) return null;
  const at = (pct) => courseGrade(course, { [itemId]: (pct / 100) * possible }).pct ?? 0;
  if (at(0) >= target) return { already: true };
  if (at(150) < target) return { impossible: true };
  let lo = 0, hi = 150;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(mid) >= target) hi = mid; else lo = mid; }
  const need = Math.ceil(hi * 10) / 10;
  return need > 100 ? { impossible: true, need } : { need };
}

// { gpa, credits } over a list of { course, pct } (pass/fail and courses without a grade yet are skipped).
export function gpaOf(rows, gpaScale = DEFAULT_GPA_SCALE) {
  let pts = 0, credits = 0;
  for (const { course, pct } of rows) {
    const g = gradingOf(course);
    const cr = num(g.credits) ?? 0;
    if (g.passFail || pct === null || !cr) continue;
    const p = gpaScale[letterFor(pct, g)];
    if (p === undefined) continue;
    pts += p * cr;
    credits += cr;
  }
  return { gpa: credits ? pts / credits : null, credits, points: pts };
}

export const fmtPct = (pct) => (pct === null || pct === undefined ? '--' : `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`);
export const fmtGpa = (g) => (g === null || g === undefined ? '--' : g.toFixed(2));