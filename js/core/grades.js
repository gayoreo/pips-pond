// Grade math. Every course has two built-in groups, Lecture and Lab, each worth a share of the
// overall grade. Inside a group are subcategories (the old "categories"): each group is weighted
// or points on its own. A weighted subcategory is a % of its group; a points subcategory has a
// typed point total that scores count toward and can go over (extra credit). Also: drop lowest,
// final replaces lowest exam, excused / not-graded-yet items, per-item and course extra credit,
// letter cutoffs per course, and GPA from a school-wide scale.

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

// The two built-in groups, in order. Lecture carries the whole grade until you split off a Lab.
export const GROUP_DEFS = [{ id: 'lecture', name: 'Lecture' }, { id: 'lab', name: 'Lab' }];

export const DEFAULT_GRADING = { scale: SCALE_PM, credits: 3, passFail: false, passMin: 70, replaceLowest: false, examCat: '' };

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function normGroup(raw, def, fallbackWeight) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const w = g.weight === '' || g.weight === undefined || g.weight === null ? fallbackWeight : Number(g.weight);
  return {
    id: def.id,
    name: def.name,
    weight: Number.isNaN(w) ? fallbackWeight : w,
    mode: g.mode === 'points' ? 'points' : 'weighted',
    categories: Array.isArray(g.categories) ? g.categories : [],
  };
}

// Reads a course's grading and always returns the two-group shape, migrating older single-level
// grading (top-level mode + categories) into the Lecture group with Lab left empty.
export function gradingOf(course) {
  const raw = course?.grading ?? {};
  let groups;
  if (Array.isArray(raw.groups) && raw.groups.length) {
    const byId = Object.fromEntries(raw.groups.map((g) => [g.id, g]));
    groups = GROUP_DEFS.map((def, i) => normGroup(byId[def.id] ?? raw.groups[i], def, i === 0 ? 100 : 0));
  } else {
    groups = [
      normGroup({ weight: 100, mode: raw.mode, categories: raw.categories }, GROUP_DEFS[0], 100),
      normGroup({ weight: 0, mode: 'points', categories: [] }, GROUP_DEFS[1], 0),
    ];
  }
  const categories = groups.flatMap((g) => g.categories); // flat list, for "is it set up" checks and lookups
  return { ...DEFAULT_GRADING, ...raw, groups, categories };
}

// A starting point offered on a fresh course: everything in Lecture, Lab empty.
export function starterGrading(mode) {
  const categories = mode === 'points'
    ? [{ name: 'Assignments', total: 100 }, { name: 'Exams', total: 300 }]
    : [{ name: 'Homework', weight: 20 }, { name: 'Quizzes', weight: 20 }, { name: 'Exams', weight: 60 }];
  return {
    groups: [
      { id: 'lecture', name: 'Lecture', weight: 100, mode, categories },
      { id: 'lab', name: 'Lab', weight: 0, mode: 'points', categories: [] },
    ],
  };
}

const isGraded = (it) => it.status !== 'excused' && it.status !== 'pending' && num(it.earned) !== null && num(it.possible) > 0;
const pctOf = (e, p) => (p > 0 ? e / p : 0);

// One subcategory from its items: { earned, possible, pct (0-1) or null, dropped: [ids] }.
// earned/possible are summed from the items; the typed point total (for points groups) is applied later.
function categoryResult(cat, items, replacement) {
  let list = items.filter(isGraded).map((it) => ({ id: it.id, earned: num(it.earned) + (num(it.extra) ?? 0), possible: num(it.possible), isFinal: Boolean(it.isFinal) }));

  if (replacement && replacement.catId === cat.id) {
    const others = list.filter((x) => !x.isFinal);
    if (others.length) {
      const lowest = others.reduce((a, b) => (pctOf(a.earned, a.possible) <= pctOf(b.earned, b.possible) ? a : b));
      if (replacement.pct > pctOf(lowest.earned, lowest.possible)) lowest.earned = replacement.pct * lowest.possible;
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
// Returns { pct (0-100+) or null, letter, cats: { catId: result }, groups: [{ id, name, weight, mode, pct, cats:[{cat,result,pct}] }] }
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
  for (const gr of g.groups) for (const c of gr.categories) cats[c.id] = categoryResult(c, byCat(c.id), replacement);

  // A subcategory's own percent, for display. Points subcats divide by their typed total, so
  // extra credit can push them past 100%.
  const catPctOf = (gr, c) => {
    const r = cats[c.id];
    if (gr.mode === 'points') { const t = num(c.total); return t ? (r.earned / t) * 100 : (r.possible > 0 ? r.pct * 100 : null); }
    return r.pct === null ? null : r.pct * 100;
  };

  // A group's percent (0-100+), or null if nothing in it is graded yet.
  const groupPct = (gr) => {
    const regular = gr.categories.filter((c) => !c.bonus);
    const bonus = gr.categories.filter((c) => c.bonus);
    if (gr.mode === 'points') {
      const P = regular.reduce((s, c) => s + (num(c.total) ?? 0), 0);
      const E = regular.reduce((s, c) => s + cats[c.id].earned, 0);
      const B = bonus.reduce((s, c) => s + cats[c.id].earned, 0);
      const anyGraded = [...regular, ...bonus].some((c) => cats[c.id].possible > 0);
      return P > 0 && anyGraded ? ((E + B) / P) * 100 : null;
    }
    const counted = regular.filter((c) => cats[c.id].pct !== null && (num(c.weight) ?? 0) > 0);
    const W = counted.reduce((s, c) => s + num(c.weight), 0);
    if (!W) return null;
    let pct = (counted.reduce((s, c) => s + num(c.weight) * cats[c.id].pct, 0) / W) * 100;
    pct += bonus.reduce((s, c) => s + (num(c.weight) ?? 0) * (cats[c.id].pct ?? 0), 0);
    return pct;
  };

  const groups = g.groups.map((gr) => ({
    id: gr.id, name: gr.name, weight: num(gr.weight) ?? 0, mode: gr.mode,
    pct: groupPct(gr),
    cats: gr.categories.map((c) => ({ cat: c, result: cats[c.id], pct: catPctOf(gr, c) })),
  }));

  let pct = null;
  const counted = groups.filter((x) => x.pct !== null && x.weight > 0);
  const W = counted.reduce((s, x) => s + x.weight, 0);
  if (W > 0) {
    pct = counted.reduce((s, x) => s + x.weight * x.pct, 0) / W;
    // Course-wide extra credit lands as percentage points on the final grade.
    const extras = course.extras ?? [];
    pct += extras.reduce((s, x) => s + (num(x.amount) ?? 0), 0);
  }
  if (pct !== null) pct = Math.round(pct * 100) / 100;
  return { pct, letter: letterFor(pct, g), cats, groups };
}

export function letterFor(pct, g) {
  if (pct === null || pct === undefined) return '';
  if (g.passFail) return pct >= (num(g.passMin) ?? 70) ? 'P' : 'F';
  const scale = [...(g.scale?.length ? g.scale : SCALE_PM)].sort((a, b) => b.min - a.min);
  return (scale.find((s) => pct >= s.min) ?? scale[scale.length - 1]).letter;
}

// Score needed on one not-yet-graded item to reach `target` percent.
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
