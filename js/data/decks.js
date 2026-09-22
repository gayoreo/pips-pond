// Flashcard decks: cards, spaced-repetition review, quizzes and bulk import.
// Saved with the rest of your pond and synced as one piece called "decks".
import { readAll, writeAll, newId } from './db.js';
import { parseCSV } from './importExport.js';
import { todayKey, addDays } from '../core/dates.js';

// How many days until a card comes back, by box. Right answers move a card up a box,
// a miss sends it back to box 0 (due again today).
const BOX_DAYS = [0, 1, 2, 4, 8, 16, 30];
export const MAX_BOX = BOX_DAYS.length - 1;

const norm = (d) => ({ decks: Array.isArray(d?.decks) ? d.decks : [] });

export const getDecks = () => norm(readAll().decks).decks;
export const getDeck = (id) => getDecks().find((d) => d.id === id) ?? null;

function change(fn, notify = true) {
  const data = readAll();
  const st = norm(data.decks);
  const result = fn(st);
  data.decks = st;
  data.meta = { ...(data.meta || {}), decks: new Date().toISOString() };
  writeAll(data, notify);
  return result;
}

const find = (st, id) => st.decks.find((d) => d.id === id);
// type: 'basic' | 'cloze' (blanks in {{ }}) | 'multi' (several answers, split by ; or new lines)
// both: also ask back to front. img: a small picture saved with the card.
const newCard = (front, back, extra = {}) => ({
  id: newId(), front, back, type: 'basic', both: false, img: '', ...extra,
  box: 0, due: todayKey(), right: 0, wrong: 0, seen: '',
});

// ---------- card types ----------
const BLANK = /\{\{(.+?)\}\}/g;
export const isCloze = (c) => c.type === 'cloze' && /\{\{.+?\}\}/.test(String(c.front ?? ''));
export const clozeBlanks = (text) => [...String(text ?? '').matchAll(BLANK)].map((m) => m[1].trim());
export const clozePrompt = (text) => String(text ?? '').replace(BLANK, '_____');
export const clozeFilled = (text) => String(text ?? '').replace(BLANK, (_, x) => x.trim());
export const answerList = (back) => String(back ?? '').split(/;|\n/).map((x) => x.trim()).filter(Boolean);

// What the card asks and what counts as right, in one direction.
export function cardFace(card, dir = 'front') {
  if (card.type === 'cloze' && clozeBlanks(card.front).length) {
    return { ask: clozePrompt(card.front), answer: clozeBlanks(card.front).join(', '), reveal: clozeFilled(card.front), answers: clozeBlanks(card.front) };
  }
  if (dir === 'back') return { ask: card.back, answer: card.front, reveal: card.front, answers: [card.front] };
  if (card.type === 'multi') {
    const answers = answerList(card.back);
    return { ask: card.front, answer: answers.join(', '), reveal: answers.join(', '), answers };
  }
  return { ask: card.front, answer: card.back, reveal: card.back, answers: [card.back] };
}

// ---------- decks ----------
export const addDeck = ({ name, courseId = '' }) => change((st) => {
  const deck = { id: newId(), name: name.trim(), courseId, cards: [], createdAt: new Date().toISOString(), lastQuiz: null, reviewedOn: [] };
  st.decks.push(deck);
  return deck;
});

export const updateDeck = (id, patch) => change((st) => { const d = find(st, id); if (d) Object.assign(d, patch); });
export const deleteDeck = (id) => change((st) => { st.decks = st.decks.filter((d) => d.id !== id); });

export const resetProgress = (id) => change((st) => {
  const d = find(st, id);
  const today = todayKey();
  for (const c of d?.cards ?? []) Object.assign(c, { box: 0, due: today, right: 0, wrong: 0, seen: '' });
});

// ---------- cards ----------
// Each entry is [front, back] or { front, back, type, both, img }.
export const addCards = (deckId, list) => change((st) => {
  const d = find(st, deckId);
  if (!d) return 0;
  for (const entry of list) {
    if (Array.isArray(entry)) d.cards.push(newCard(entry[0], entry[1]));
    else d.cards.push(newCard(entry.front, entry.back, { type: entry.type ?? 'basic', both: Boolean(entry.both), img: entry.img ?? '' }));
  }
  return list.length;
});

export const updateCard = (deckId, cardId, patch) => change((st) => {
  const c = find(st, deckId)?.cards.find((x) => x.id === cardId);
  if (c) Object.assign(c, patch);
});

// Puts a deleted card or deck back, for undo.
export const restoreCard = (deckId, card) => change((st) => {
  const d = find(st, deckId);
  if (d && card && !d.cards.some((c) => c.id === card.id)) d.cards.push(card);
});
export const restoreDeck = (deck) => change((st) => { if (deck && !st.decks.some((d) => d.id === deck.id)) st.decks.push(deck); });

export const deleteCard = (deckId, cardId) => change((st) => {
  const d = find(st, deckId);
  if (d) d.cards = d.cards.filter((c) => c.id !== cardId);
});

// ---------- review (spaced repetition) ----------
export const dueCards = (deck, today = todayKey()) => deck.cards.filter((c) => (c.due || today) <= today);
export const totalDue = (today = todayKey()) => getDecks().reduce((n, d) => n + dueCards(d, today).length, 0);

export const gradeCard = (deckId, cardId, correct) => change((st) => {
  const d = find(st, deckId);
  const c = d?.cards.find((x) => x.id === cardId);
  if (!c) return;
  const today = todayKey();
  // Day by day counts, for the stats screen.
  d.log = (d.log ?? []).filter((x) => x.d > addDays(today, -60));
  const row = d.log.find((x) => x.d === today) ?? (d.log.push({ d: today, n: 0, r: 0 }), d.log[d.log.length - 1]);
  row.n += 1;
  if (correct) row.r += 1;
  if (correct) { c.box = Math.min((c.box || 0) + 1, MAX_BOX); c.right = (c.right || 0) + 1; }
  else { c.box = 0; c.wrong = (c.wrong || 0) + 1; }
  c.due = addDays(today, BOX_DAYS[c.box]);
  c.seen = today;
});

export const markReviewed = (deckId) => change((st) => {
  const d = find(st, deckId);
  if (!d) return;
  const today = todayKey();
  d.reviewedOn = [...new Set([...(d.reviewedOn ?? []), today])].sort().slice(-60);
});

// Days in a row (ending today or yesterday) with at least one review in any deck.
export function reviewStreak(today = todayKey()) {
  const days = new Set(getDecks().flatMap((d) => d.reviewedOn ?? []));
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

// ---------- stats ----------
// { cards, learned, due, new, accuracy (0-1 or null), answered, hardest: [cards], days: [{ d, n, r }] }
export function deckStats(deck, today = todayKey()) {
  const cards = deck.cards ?? [];
  const right = cards.reduce((n, c) => n + (c.right || 0), 0);
  const wrong = cards.reduce((n, c) => n + (c.wrong || 0), 0);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push((deck.log ?? []).find((x) => x.d === d) ?? { d, n: 0, r: 0 });
  }
  return {
    cards: cards.length,
    learned: cards.filter((c) => (c.box || 0) >= 3).length,
    due: dueCards(deck, today).length,
    fresh: cards.filter((c) => !c.seen).length,
    answered: right + wrong,
    accuracy: right + wrong ? right / (right + wrong) : null,
    hardest: [...cards].filter((c) => (c.wrong || 0) > 0).sort((a, b) => (b.wrong - b.right) - (a.wrong - a.right)).slice(0, 5),
    days,
  };
}

// ---------- quizzes ----------
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// mode: 'choice' | 'type' | 'mix'. direction: 'front' (show front, answer back) or 'back'.
export function buildQuiz(deck, { mode = 'mix', direction = 'front', count = 10, onlyIds = null } = {}) {
  let pool = deck.cards.filter((c) => c.front && (c.back || isCloze(c)));
  if (onlyIds) pool = pool.filter((c) => onlyIds.includes(c.id));
  const picked = shuffle(pool).slice(0, count > 0 ? count : pool.length);
  const allAnswers = [...new Set(deck.cards.map((c) => cardFace(c, direction).answer).filter((a) => a && a.length < 80))];
  return picked.map((c, i) => {
    const face = cardFace(c, direction);
    let kind = mode === 'mix' ? (i % 2 ? 'type' : 'choice') : mode;
    const others = shuffle(allAnswers.filter((a) => a !== face.answer)).slice(0, 3);
    // Multiple choice needs one short answer and some decoys; otherwise it's typed.
    if (kind === 'choice' && (others.length < 1 || face.answer.length > 80)) kind = 'type';
    return {
      cardId: c.id,
      ask: face.ask,
      img: c.img || '',
      answer: face.answer,
      answers: face.answers,
      note: c.type === 'multi' && face.answers.length > 1 ? `Any one of ${face.answers.length}` : '',
      kind,
      options: kind === 'choice' ? shuffle([face.answer, ...others]) : [],
    };
  });
}

const clean = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Typed answers forgive case, punctuation, accents and a small typo.
export function checkTyped(given, answer) {
  const g = clean(given);
  const a = clean(answer);
  if (!g) return false;
  if (g === a) return true;
  const allowed = a.length > 12 ? 2 : a.length > 4 ? 1 : 0;
  return distance(g, a) <= allowed;
}

// Right if it matches any of the card's answers (multi-answer cards and fill-in-the-blanks).
export const checkAny = (given, answers) => (answers ?? []).some((a) => checkTyped(given, a));

// Saves the score, and sends missed cards back to the start of the review boxes.
export const saveQuizResult = (deckId, { score, total, missed }) => change((st) => {
  const d = find(st, deckId);
  if (!d) return;
  const today = todayKey();
  d.lastQuiz = { date: today, score, total, missed };
  for (const c of d.cards) if (missed.includes(c.id)) Object.assign(c, { box: 0, due: today });
  d.reviewedOn = [...new Set([...(d.reviewedOn ?? []), today])].sort().slice(-60);
});

// ---------- bulk import ----------
const SEPS = { tab: '\t', dash: ' - ', colon: ':', comma: ',', equals: ' = ' };
const AUTO_ORDER = ['tab', 'dash', 'equals', 'colon', 'comma'];

// One card per line: "term<sep>definition". sep: 'auto' or a key of SEPS.
export function parseCardLines(text, sep = 'auto') {
  const cards = [];
  let skipped = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = sep === 'auto' ? AUTO_ORDER.find((k) => line.includes(SEPS[k])) : sep;
    const at = key ? line.indexOf(SEPS[key]) : -1;
    if (at < 1) { skipped++; continue; }
    const front = line.slice(0, at).trim();
    const back = line.slice(at + SEPS[key].length).trim();
    if (front && back) cards.push([front, back]); else skipped++;
  }
  return { cards, skipped };
}

// CSV: first two filled columns of each row. A "term,definition" style header row is skipped.
export function parseCardCSV(text) {
  const rows = parseCSV(text);
  const cards = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean);
    if (i === 0 && cells.length >= 2 && /^(term|front|word|question|q)$/i.test(cells[0]) && /^(definition|back|meaning|answer|a)$/i.test(cells[1])) return;
    if (cells.length >= 2) cards.push([cells[0], cells[1]]); else if (cells.length) skipped++;
  });
  return { cards, skipped };
}

// For the reminder server: how many cards come due on each of the next two weeks' days.
// Anything already due is counted on

export function cardsDueMap(data) {
  const today = todayKey();
  const until = addDays(today, 14);
  const map = {};
  for (const d of norm(data.decks).decks) {
    for (const c of d.cards) {
      const day = !c.due || c.due < today ? today : c.due;
      if (day <= until) map[day] = (map[day] || 0) + 1;
    }
  }
  return map;
}
