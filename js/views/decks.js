// Flashcard screens: one deck (cards, import), Review (spaced repetition), Flip through, and Quiz.
import {
  getDeck, updateDeck, deleteDeck, resetProgress, addCards, updateCard, deleteCard, dueCards, gradeCard, markReviewed,
  reviewStreak, buildQuiz, checkTyped, checkAny, saveQuizResult, parseCardLines, parseCardCSV, MAX_BOX,
  cardFace, clozePrompt, clozeFilled, answerList, deckStats, isCloze,
} from '../data/decks.js';
import { shareDeck, unshareDeck, fetchShared, importShared, shareSize, SHARE_LIMIT } from '../data/share.js';
import { userNow } from '../data/supabase.js';
import { appUrl } from '../data/auth.js';
import { getStudy } from '../data/study.js';
import { getProfile } from '../data/db.js';
import { frogSVG } from '../pip/frog.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';
import { openSheet } from '../ui/sheet.js';

const DECK_KEY = 'study:deck';
const deckId = () => { try { return sessionStorage.getItem(DECK_KEY) || ''; } catch { return ''; } };
const state = { importNow: false, search: '', review: null, flip: null, quiz: null };

export function openDeck(id, { importNow = false } = {}) {
  try { sessionStorage.setItem(DECK_KEY, id); } catch { /* ignore */ }
  state.importNow = importNow;
  state.search = '';
  location.hash = '#/deck';
}

const backToDecks = () => { try { sessionStorage.setItem('study:mode', 'decks'); } catch { /* ignore */ } location.hash = '#/study'; };
const CARD_TYPES = { basic: 'Front and back', cloze: 'Fill in the blank', multi: 'Several answers' };

// Pictures are shrunk to about 700px and saved with the card, so they sync and work offline.
async function shrinkImage(file, max = 700, quality = 0.62) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

const cardImg = (src, alt = '') => (src ? `<img class="card-img" src="${esc(src)}" alt="${esc(alt)}">` : '');
const typeTag = (c) => (c.type && c.type !== 'basic' ? `<span class="dn-tag">${esc(c.type === 'cloze' ? 'blank' : 'multi')}</span>` : '');

const boxDots = (c) => `<span class="box-dots" aria-label="Learned ${c.box || 0} of ${MAX_BOX}">${Array.from({ length: MAX_BOX }, (_, i) => `<i class="${i < (c.box || 0) ? 'on' : ''}"></i>`).join('')}</span>`;

// ---------- one deck ----------
export async function renderDeck(root) {
  const deck = getDeck(deckId());
  if (!deck) { backToDecks(); return; }
  const course = getStudy().courses.find((c) => c.id === deck.courseId);
  const due = dueCards(deck).length;
  const q = state.search.trim().toLowerCase();
  const cards = q ? deck.cards.filter((c) => `${c.front} ${c.back}`.toLowerCase().includes(q)) : deck.cards;

  root.innerHTML = `
  <div class="deck-page stack">
    <div class="sheet__head">
      <button type="button" class="btn-plain btn-plain--muted" data-back>decks</button>
      <span class="spacer"></span>
      <button type="button" class="btn-plain" data-edit-deck>edit</button>
    </div>
    <header style="--course:${course?.color ?? 'var(--tape)'}" class="deck-head">
      ${course ? `<p class="eyebrow">${esc(course.name)}</p>` : ''}
      <h1 class="page-title">${esc(deck.name)}</h1>
      <p class="card__hint">${deck.cards.length} ${deck.cards.length === 1 ? 'card' : 'cards'} · ${due} due${deck.lastQuiz ? ` · last quiz ${deck.lastQuiz.score}/${deck.lastQuiz.total}` : ''}</p>
    </header>
    <div class="deck-actions">
      <button type="button" class="btn-sketch btn-sketch--go" data-go="review"${due ? '' : ' disabled'}>${due ? `Review ${due}` : 'Nothing due'}</button>
      <button type="button" class="btn-sketch" data-go="flip"${deck.cards.length ? '' : ' disabled'}>Flip through</button>
      <button type="button" class="btn-sketch" data-go="quiz"${deck.cards.length > 1 ? '' : ' disabled'}>Quiz</button>
    </div>
    <div class="row">
      <button type="button" class="btn-plain" data-add-card>+ add a card</button>
      <button type="button" class="btn-plain" data-import>import a list</button>
      <button type="button" class="btn-plain" data-stats>stats</button>
      <button type="button" class="btn-plain" data-share>share</button>
    </div>
    ${deck.cards.length > 8 ? `<label class="field">Search<input type="search" data-search value="${esc(state.search)}" autocomplete="off"></label>` : ''}
    ${deck.cards.length ? `<ul class="card-list">${cards.map((c) => `
      <li><button type="button" class="card-row" data-card="${esc(c.id)}">
        <span class="card-row__front">${c.img ? '📷 ' : ''}${esc(isCloze(c) ? clozePrompt(c.front) : c.front)} ${typeTag(c)}</span>
        <span class="card-row__back">${esc(isCloze(c) ? clozeFilled(c.front) : c.back)}</span>
        ${boxDots(c)}
      </button></li>`).join('')}</ul>` : '<p class="card__hint">No cards yet. Tap "import a list" to paste a bunch at once.</p>'}
  </div>`;

  const page = root.querySelector('.deck-page');
  page.querySelector('[data-search]')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    renderDeck(root).then(() => { const el = root.querySelector('[data-search]'); el?.focus(); el?.setSelectionRange(pos, pos); });
  });
  page.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-back]')) return backToDecks();
    const go = t.closest('[data-go]');
    if (go) {
      if (go.dataset.go === 'review') state.review = null;
      if (go.dataset.go === 'flip') state.flip = null;
      if (go.dataset.go === 'quiz') state.quiz = null;
      location.hash = `#/${go.dataset.go}`;
      return undefined;
    }
    if (t.closest('[data-add-card]')) return openCardSheet(deck.id, null);
    if (t.closest('[data-import]')) return openImportSheet(deck.id);
    if (t.closest('[data-stats]')) return openStatsSheet(deck.id);
    if (t.closest('[data-share]')) return openShareSheet(deck.id);
    if (t.closest('[data-edit-deck]')) return openDeckSettings(deck.id);
    const card = t.closest('[data-card]');
    if (card) return openCardSheet(deck.id, deck.cards.find((c) => c.id === card.dataset.card));
    return undefined;
  });

  if (state.importNow) { state.importNow = false; openImportSheet(deck.id); }
}

function openCardSheet(deckIdValue, card) {
  const editing = Boolean(card);
  let type = card?.type ?? 'basic';
  let img = card?.img ?? '';
  const html = `
    <div class="seg seg--3" role="group" aria-label="Card type">
      ${Object.entries(CARD_TYPES).map(([k, label]) => `<button type="button" data-ctype="${k}" aria-pressed="${type === k}">${label}</button>`).join('')}
    </div>
    <p class="card__hint" data-type-hint></p>
    <label class="field"><span data-front-label>Front</span><textarea class="study-notes" name="front" rows="2">${esc(card?.front ?? '')}</textarea></label>
    <label class="field" data-back-row${type === 'cloze' ? ' hidden' : ''}><span data-back-label>Back</span><textarea class="study-notes" name="back" rows="3">${esc(card?.back ?? '')}</textarea></label>
    <label class="row" data-both-row${type === 'cloze' ? ' hidden' : ''}><span>Ask it both ways</span><input type="checkbox" class="switch" name="both"${card?.both ? ' checked' : ''}></label>
    <div class="card-img-row">
      <div data-img-preview>${cardImg(img, 'Picture on this card')}</div>
      <label class="field"><span class="field__label">Picture <span class="muted">(optional)</span></span><input type="file" name="pic" accept="image/*"></label>
      ${img ? '' : ''}
      <button type="button" class="btn-plain btn-plain--danger" data-rm-img${img ? '' : ' hidden'}>remove picture</button>
    </div>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>${editing ? 'Save' : 'Add card'}</button>
    ${editing ? '<button type="button" class="btn-plain btn-plain--danger" data-delete>delete card</button>' : '<p class="card__hint">The sheet stays open so you can keep adding.</p>'}`;
  openSheet(editing ? 'Edit card' : 'Add a card', html, (sheet, close) => {
    const front = sheet.querySelector('[name="front"]');
    const back = sheet.querySelector('[name="back"]');
    const hint = sheet.querySelector('[data-type-hint]');
    const paint = () => {
      hint.textContent = type === 'cloze'
        ? 'Put the hidden part in double braces: The capital of France is {{Paris}}.'
        : type === 'multi' ? 'Put each answer on its own line, or split them with semicolons. Any one counts as right.'
        : 'A normal card: a term on the front, its meaning on the back.';
      sheet.querySelector('[data-front-label]').textContent = type === 'cloze' ? 'Sentence with blanks' : 'Front';
      sheet.querySelector('[data-back-label]').textContent = type === 'multi' ? 'Answers' : 'Back';
      sheet.querySelector('[data-back-row]').hidden = type === 'cloze';
      sheet.querySelector('[data-both-row]').hidden = type !== 'basic';
      sheet.querySelectorAll('[data-ctype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ctype === type)));
    };
    paint();
    front.focus();

    sheet.querySelector('[name="pic"]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        img = await shrinkImage(file);
        if (img.length > 400_000) img = await shrinkImage(file, 500, 0.5);
        sheet.querySelector('[data-img-preview]').innerHTML = cardImg(img, 'Picture on this card');
        sheet.querySelector('[data-rm-img]').hidden = false;
      } catch { toast('Couldn’t read that picture.'); }
      e.target.value = '';
    });

    sheet.addEventListener('click', (e) => {
      const ct = e.target.closest('[data-ctype]');
      if (ct) { type = ct.dataset.ctype; paint(); return; }
      if (e.target.closest('[data-rm-img]')) {
        img = '';
        sheet.querySelector('[data-img-preview]').innerHTML = '';
        e.target.hidden = true;
        return;
      }
      if (e.target.closest('[data-delete]')) {
        if (!confirm('Delete this card?')) return;
        deleteCard(deckIdValue, card.id);
        close();
        return;
      }
      if (!e.target.closest('[data-save]')) return;
      const f = front.value.trim();
      const b = back.value.trim();
      if (!f) { toast('Fill in the front.'); return; }
      if (type === 'cloze' && !/\{\{.+?\}\}/.test(f)) { toast('Wrap the hidden part in {{ }}.'); return; }
      if (type !== 'cloze' && !b) { toast('Fill in both sides.'); return; }
      const both = type === 'basic' && sheet.querySelector('[name="both"]').checked;
      if (editing) { updateCard(deckIdValue, card.id, { front: f, back: type === 'cloze' ? '' : b, type, both, img }); close(); return; }
      addCards(deckIdValue, [{ front: f, back: type === 'cloze' ? '' : b, type, both, img }]);
      play('pop');
      front.value = '';
      back.value = '';
      img = '';
      sheet.querySelector('[data-img-preview]').innerHTML = '';
      sheet.querySelector('[data-rm-img]').hidden = true;
      front.focus();
    });
  });
}

// ---------- stats ----------
function openStatsSheet(id) {
  const deck = getDeck(id);
  const st = deckStats(deck);
  const most = Math.max(1, ...st.days.map((d) => d.n));
  const pct = (n) => Math.round((n / most) * 100);
  const html = `
    <div class="stat-row">
      <div><p class="gpa-card__num">${st.cards}</p><p class="muted">cards</p></div>
      <div><p class="gpa-card__num">${st.learned}</p><p class="muted">learned</p></div>
      <div><p class="gpa-card__num">${st.accuracy === null ? '--' : `${Math.round(st.accuracy * 100)}%`}</p><p class="muted">right</p></div>
    </div>
    <p class="card__hint">${st.due} due now · ${st.fresh} never seen · ${st.answered} answers so far${reviewStreak() > 1 ? ` · ${reviewStreak()}-day streak` : ''}</p>
    <p class="fw-sub">Last two weeks</p>
    <div class="spark">${st.days.map((d) => `<span class="spark__bar" style="--h:${pct(d.n)}%" title="${esc(d.d)}: ${d.n}"><i style="--h:${d.n ? Math.round((d.r / d.n) * 100) : 0}%"></i></span>`).join('')}</div>
    <p class="card__hint">Bar height is how many cards you answered. The filled part is how many you got right.</p>
    ${st.hardest.length ? `<p class="fw-sub">Hardest cards</p>
      <ul class="grade-items">${st.hardest.map((c) => `<li><button type="button" data-hard="${esc(c.id)}">
        <span class="grade-items__name">${esc(isCloze(c) ? clozePrompt(c.front) : c.front)}</span>
        <span class="grade-items__score">${c.right || 0} right · ${c.wrong || 0} missed</span></button></li>`).join('')}</ul>`
      : '<p class="card__hint">No misses yet. Review a few cards and they show up here.</p>'}`;
  openSheet(`${deck.name} stats`, html, (sheet, close) => {
    sheet.addEventListener('click', (e) => {
      const h = e.target.closest('[data-hard]');
      if (!h) return;
      const card = getDeck(id)?.cards.find((c) => c.id === h.dataset.hard);
      close();
      if (card) openCardSheet(id, card);
    });
  });
}

// ---------- sharing ----------
function openShareSheet(id) {
  const deck = getDeck(id);
  const kb = Math.round(shareSize(deck) / 1024);
  const html = `
    ${userNow() ? `
      <p class="card__hint">Sharing puts a copy of this deck's cards online under a short code. Anyone with the code can copy it into their own decks. Your review progress and scores stay private.</p>
      <div data-share-body><p class="card__hint">Checking…</p></div>
      <p class="card__hint">${deck.cards.length} cards · about ${kb} KB${kb > Math.round(SHARE_LIMIT / 1024) ? ' · too big to share, remove some pictures' : ''}</p>`
    : '<p class="card__hint">Sign in to share decks with friends.</p>'}
    <p class="fw-sub">Have a code?</p>
    <div class="row">
      <label class="field grow"><span class="field__label">Deck code</span><input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="AB12CD"></label>
      <button type="button" class="btn-sketch btn-sketch--small" data-get>copy it</button>
    </div>`;
  openSheet('Share this deck', html, (sheet, close) => {
    const body = sheet.querySelector('[data-share-body]');
    let code = '';
    const paint = () => {
      if (!body) return;
      body.innerHTML = code ? `
        <p>Code: <code class="shortcut__url">${esc(code)}</code></p>
        <div class="row">
          <button type="button" class="btn-plain" data-copy>copy link</button>
          <button type="button" class="btn-plain" data-update>update the shared copy</button>
          <button type="button" class="btn-plain btn-plain--danger" data-stop>stop sharing</button>
        </div>`
        : '<button type="button" class="btn-sketch btn-sketch--go" data-publish>share this deck</button>';
    };
    if (userNow()) {
      import('../data/share.js').then(({ myShares }) => myShares()).then((rows) => {
        code = (rows ?? []).find((r) => r.name === deck.name)?.code ?? '';
        paint();
      }).catch(() => paint());
    }
    sheet.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-publish]') || t.closest('[data-update]')) {
        t.closest('button').disabled = true;
        try {
          code = await shareDeck(id, code || null);
          paint();
          play('ribbit');
          toast('Shared! Send the code or link to a friend.');
        } catch (err) { toast(err.message); t.closest('button').disabled = false; }
        return;
      }
      if (t.closest('[data-copy]')) {
        const link = `${appUrl()}?deck=${code}`;
        try { await navigator.clipboard.writeText(link); toast('Link copied!'); } catch { toast(link); }
        return;
      }
      if (t.closest('[data-stop]')) {
        if (!confirm('Stop sharing this deck? The code stops working.')) return;
        try { await unshareDeck(code); code = ''; paint(); toast('Not shared any more.'); } catch (err) { toast(err.message); }
        return;
      }
      if (!t.closest('[data-get]')) return;
      const typed = sheet.querySelector('[name="code"]').value.trim();
      if (!typed) { toast('Type the code a friend gave you.'); return; }
      close();
      await importByCode(typed);
    });
  });
}

// Copies a shared deck into your own decks, by code.
export async function importByCode(code) {
  if (!userNow()) { toast('Sign in to copy a shared deck.'); return; }
  try {
    const row = await fetchShared(code);
    if (!confirm(`Copy "${row.name}" (${row.cards} cards)${row.owner_name ? ` from ${row.owner_name}` : ''} into your decks?`)) return;
    const { deck, count } = importShared(row);
    play('ribbit');
    toast(`Copied ${count} ${count === 1 ? 'card' : 'cards'}.`);
    openDeck(deck.id);
  } catch (err) { toast(err.message); }
}

function openImportSheet(deckIdValue) {
  const html = `
    <p class="card__hint">One card per line: the term, then a tab, dash, colon or comma, then the definition. Copying two columns from Quizlet, Google Sheets or Excel works as is.</p>
    <textarea class="study-notes import-box" name="text" rows="8" placeholder="mitochondria - makes energy for the cell"></textarea>
    <label class="field">Split each line on
      <select name="sep">
        <option value="auto">Figure it out</option>
        <option value="tab">Tab</option>
        <option value="dash">Dash ( - )</option>
        <option value="colon">Colon ( : )</option>
        <option value="comma">Comma ( , )</option>
        <option value="equals">Equals ( = )</option>
      </select>
    </label>
    <label class="field">Or pick a CSV file<input type="file" name="file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label>
    <div class="import-preview" data-preview></div>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save disabled>Add cards</button>`;
  openSheet('Import cards', html, (sheet, close) => {
    const text = sheet.querySelector('[name="text"]');
    const sep = sheet.querySelector('[name="sep"]');
    const preview = sheet.querySelector('[data-preview]');
    const save = sheet.querySelector('[data-save]');
    let parsed = { cards: [], skipped: 0 };
    const show = () => {
      const n = parsed.cards.length;
      preview.innerHTML = n || parsed.skipped ? `
        <p><b>${n} ${n === 1 ? 'card' : 'cards'} found.</b>${parsed.skipped ? ` ${parsed.skipped} ${parsed.skipped === 1 ? 'line' : 'lines'} skipped (no separator).` : ''}</p>
        <ul>${parsed.cards.slice(0, 3).map(([f, b]) => `<li><b>${esc(f)}</b> · ${esc(b)}</li>`).join('')}</ul>` : '';
      save.disabled = !n;
      save.textContent = n ? `Add ${n} ${n === 1 ? 'card' : 'cards'}` : 'Add cards';
    };
    const fromText = () => { parsed = parseCardLines(text.value, sep.value); show(); };
    text.addEventListener('input', fromText);
    sep.addEventListener('change', fromText);
    sheet.querySelector('[name="file"]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const raw = await file.text();
      parsed = /\t/.test(raw.split(/\r?\n/)[0] ?? '') ? parseCardLines(raw, 'tab') : parseCardCSV(raw);
      show();
    });
    text.focus();
    save.addEventListener('click', () => {
      const n = addCards(deckIdValue, parsed.cards);
      close();
      play('ribbit');
      toast(`Added ${n} ${n === 1 ? 'card' : 'cards'}.`);
    });
  });
}

function openDeckSettings(id) {
  const deck = getDeck(id);
  const courses = getStudy().courses;
  const html = `
    <label class="field">Deck name<input name="name" maxlength="60" value="${esc(deck.name)}"></label>
    <label class="field">Course
      <select name="course">
        <option value="">No course</option>
        ${courses.map((c) => `<option value="${esc(c.id)}"${c.id === deck.courseId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="btn-sketch btn-sketch--go" data-save>Save</button>
    <button type="button" class="btn-plain" data-reset>start review progress over</button>
    <button type="button" class="btn-plain btn-plain--danger" data-delete>delete deck</button>`;
  openSheet('Edit deck', html, (sheet, close) => {
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-save]')) {
        const name = sheet.querySelector('[name="name"]').value.trim();
        if (!name) { toast('Give the deck a name.'); return; }
        updateDeck(id, { name, courseId: sheet.querySelector('[name="course"]').value });
        close();
      } else if (e.target.closest('[data-reset]')) {
        if (!confirm('Make every card new again? All cards become due today.')) return;
        resetProgress(id);
        close();
        toast('Progress reset.');
      } else if (e.target.closest('[data-delete]')) {
        if (!confirm(`Delete ${deck.name} and all ${deck.cards.length} cards?`)) return;
        close();
        deleteDeck(id);
        backToDecks();
      }
    });
  });
}

// ---------- shared end screen ----------
async function endScreen(root, { mood, title, lines, buttons }) {
  const { frogName } = await getProfile();
  root.innerHTML = `
  <div class="session session--end">
    <div class="frog is-${mood}">${frogSVG(mood, frogName)}</div>
    <h1 class="page-title">${esc(title)}</h1>
    ${lines.map((l) => `<p>${l}</p>`).join('')}
    <div class="stack">${buttons}</div>
  </div>`;
}

// ---------- review ----------
export async function renderReview(root) {
  const deck = getDeck(deckId());
  if (!deck) { backToDecks(); return; }
  if (!state.review || state.review.deckId !== deck.id) {
    const queue = [...dueCards(deck)].sort(() => Math.random() - 0.5).map((c) => c.id);
    // Cards set to "ask both ways" come up front-to-back or back-to-front, picked when the card comes up.
    state.review = { deckId: deck.id, queue, dirs: {}, shown: false, done: 0, firstTry: 0, missedOnce: new Set(), total: queue.length };
  }
  const r = state.review;
  if (!r.queue.length) {
    if (r.total) markReviewed(deck.id);
    const streak = reviewStreak();
    return endScreen(root, {
      mood: 'happy',
      title: r.total ? 'All caught up!' : 'Nothing due right now',
      lines: r.total
        ? [`Reviewed ${r.total} ${r.total === 1 ? 'card' : 'cards'}. ${r.firstTry} right on the first try.`, streak > 1 ? `${streak}-day review streak.` : '']
        : ['Come back tomorrow, or flip through the deck to practice.'],
      buttons: '<a class="btn-sketch btn-sketch--go" href="#/deck">back to the deck</a>',
    });
  }
  const card = deck.cards.find((c) => c.id === r.queue[0]);
  if (!card) { r.queue.shift(); return renderReview(root); }
  r.dirs[card.id] ??= card.both && Math.random() < 0.5 ? 'back' : 'front';
  const face = cardFace(card, r.dirs[card.id]);

  root.innerHTML = `
  <div class="session">
    <div class="session__top">
      <a class="btn-plain btn-plain--muted" href="#/deck">stop</a>
      <p class="eyebrow">${r.done + 1} of ${r.done + r.queue.length}</p>
      <span class="spacer"></span>
    </div>
    <button type="button" class="flash${r.shown ? ' is-shown' : ''}" data-reveal aria-live="polite">
      ${cardImg(card.img)}
      <span class="flash__front">${esc(face.ask)}</span>
      ${r.shown ? `<span class="flash__back">${esc(face.reveal)}</span>` : '<span class="flash__hint">tap to show the answer</span>'}
      ${!r.shown && card.type === 'multi' && face.answers.length > 1 ? `<span class="flash__hint">${face.answers.length} answers</span>` : ''}
    </button>
    ${r.shown ? `
    <div class="grade">
      <button type="button" class="btn-sketch grade--miss" data-grade="0">missed it</button>
      <button type="button" class="btn-sketch btn-sketch--go" data-grade="1">got it</button>
    </div>` : ''}
  </div>`;

  const grade = (ok) => {
    gradeCard(deck.id, card.id, ok);
    r.queue.shift();
    if (ok) { r.done++; if (!r.missedOnce.has(card.id)) r.firstTry++; play('pop'); }
    else { r.missedOnce.add(card.id); r.queue.push(card.id); play('stamp'); }
    r.shown = false;
    renderReview(root);
  };
  root.querySelector('.session').addEventListener('click', (e) => {
    if (e.target.closest('[data-reveal]') && !r.shown) { r.shown = true; renderReview(root); return; }
    const g = e.target.closest('[data-grade]');
    if (g) grade(g.dataset.grade === '1');
  });
  root.onkeydown = null;
  document.onkeydown = (e) => {
    if (location.hash !== '#/review') { document.onkeydown = null; return; }
    if (!r.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); r.shown = true; renderReview(root); }
    else if (r.shown && (e.key === '1' || e.key === 'ArrowLeft')) grade(false);
    else if (r.shown && (e.key === '2' || e.key === 'ArrowRight')) grade(true);
  };
  return undefined;
}

// ---------- flip through ----------
export async function renderFlip(root) {
  const deck = getDeck(deckId());
  if (!deck || !deck.cards.length) { backToDecks(); return; }
  if (!state.flip || state.flip.deckId !== deck.id) state.flip = { deckId: deck.id, order: deck.cards.map((c) => c.id), i: 0, flipped: false, backFirst: false, shuffled: false };
  const f = state.flip;
  f.order = f.order.filter((id) => deck.cards.some((c) => c.id === id));
  f.i = Math.min(f.i, f.order.length - 1);
  const card = deck.cards.find((c) => c.id === f.order[f.i]);
  const showBack = f.flipped !== f.backFirst;

  root.innerHTML = `
  <div class="session">
    <div class="session__top">
      <a class="btn-plain btn-plain--muted" href="#/deck">done</a>
      <p class="eyebrow">${f.i + 1} of ${f.order.length}</p>
      <span class="spacer"></span>
    </div>
    <button type="button" class="flash flash--flip${showBack ? ' is-back' : ''}" data-flip>
      <span class="flash__side">${showBack ? 'back' : 'front'}</span>
      ${cardImg(card.img)}
      <span class="flash__front">${esc(isCloze(card) ? (showBack ? clozeFilled(card.front) : clozePrompt(card.front)) : showBack ? card.back : card.front)}</span>
      <span class="flash__hint">tap to flip</span>
    </button>
    <div class="grade">
      <button type="button" class="btn-sketch" data-step="-1"${f.i === 0 ? ' disabled' : ''}>‹ back</button>
      <button type="button" class="btn-sketch" data-step="1"${f.i >= f.order.length - 1 ? ' disabled' : ''}>next ›</button>
    </div>
    <div class="row">
      <label class="row"><span>Shuffle</span><input type="checkbox" class="switch" data-shuffle${f.shuffled ? ' checked' : ''}></label>
      <label class="row"><span>Back first</span><input type="checkbox" class="switch" data-backfirst${f.backFirst ? ' checked' : ''}></label>
    </div>
  </div>`;

  const page = root.querySelector('.session');
  const step = (n) => { f.i = Math.max(0, Math.min(f.order.length - 1, f.i + n)); f.flipped = false; renderFlip(root); };
  page.addEventListener('click', (e) => {
    if (e.target.closest('[data-flip]')) { f.flipped = !f.flipped; renderFlip(root); return; }
    const s = e.target.closest('[data-step]');
    if (s) step(Number(s.dataset.step));
  });
  page.addEventListener('change', (e) => {
    if (e.target.matches('[data-shuffle]')) {
      f.shuffled = e.target.checked;
      f.order = f.shuffled ? [...f.order].sort(() => Math.random() - 0.5) : deck.cards.map((c) => c.id);
      f.i = 0; f.flipped = false; renderFlip(root);
    }
    if (e.target.matches('[data-backfirst]')) { f.backFirst = e.target.checked; f.flipped = false; renderFlip(root); }
  });
  document.onkeydown = (e) => {
    if (location.hash !== '#/flip') { document.onkeydown = null; return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); f.flipped = !f.flipped; renderFlip(root); }
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  };
}

// ---------- quiz ----------
export async function renderQuiz(root) {
  const deck = getDeck(deckId());
  if (!deck) { backToDecks(); return; }
  state.quiz ??= { deckId: deck.id, phase: 'setup', mode: 'mix', direction: 'front', count: 10, only: null };
  const z = state.quiz;
  if (z.deckId !== deck.id) { state.quiz = null; renderQuiz(root); return; }

  if (z.phase === 'setup') {
    const lastMissed = deck.lastQuiz?.missed?.filter((id) => deck.cards.some((c) => c.id === id)) ?? [];
    const seg = (name, options, value) => `
      <div class="seg" role="group" style="grid-template-columns:repeat(${options.length},1fr)">
        ${options.map(([v, label]) => `<button type="button" data-${name}="${v}" aria-pressed="${String(value) === String(v)}">${label}</button>`).join('')}
      </div>`;
    root.innerHTML = `
    <div class="session stack">
      <div class="session__top">
        <a class="btn-plain btn-plain--muted" href="#/deck">cancel</a>
        <p class="eyebrow">Quiz · ${esc(deck.name)}</p>
        <span class="spacer"></span>
      </div>
      <h1 class="page-title">Build a quiz</h1>
      <p class="field">Questions</p>
      ${seg('mode', [['choice', 'multiple choice'], ['type', 'type it'], ['mix', 'mix']], z.mode)}
      <p class="field">Show me</p>
      ${seg('direction', [['front', 'the front'], ['back', 'the back']], z.direction)}
      <p class="field">How many</p>
      ${seg('count', [[10, '10'], [20, '20'], [0, `all ${deck.cards.length}`]], z.count)}
      ${lastMissed.length ? `<label class="row"><span>Only the ${lastMissed.length} I missed last time</span><input type="checkbox" class="switch" data-only${z.only ? ' checked' : ''}></label>` : ''}
      <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-start>Start</button>
    </div>`;
    const page = root.querySelector('.session');
    page.addEventListener('click', (e) => {
      for (const key of ['mode', 'direction', 'count']) {
        const b = e.target.closest(`[data-${key}]`);
        if (b) { z[key] = key === 'count' ? Number(b.dataset[key]) : b.dataset[key]; renderQuiz(root); return; }
      }
      if (e.target.closest('[data-start]')) {
        const questions = buildQuiz(deck, { mode: z.mode, direction: z.direction, count: z.count, onlyIds: z.only });
        if (!questions.length) { toast('No cards to quiz on.'); return; }
        Object.assign(z, { phase: 'ask', questions, i: 0, right: 0, missed: [], answered: null });
        renderQuiz(root);
      }
    });
    page.querySelector('[data-only]')?.addEventListener('change', (e) => { z.only = e.target.checked ? lastMissed : null; });
    return;
  }

  if (z.phase === 'done') {
    const pct = z.right / z.questions.length;
    const missedCards = z.missed.map((id) => deck.cards.find((c) => c.id === id)).filter(Boolean);
    await endScreen(root, {
      mood: pct >= 0.8 ? 'happy' : pct >= 0.5 ? 'worried' : 'sad',
      title: `${z.right} / ${z.questions.length}`,
      lines: [
        pct === 1 ? 'Perfect score!' : pct >= 0.8 ? 'Nice work.' : 'Keep at it. Retrying the missed ones helps a lot.',
        missedCards.length ? `<ul class="missed-list">${missedCards.map((c) => `<li><b>${esc(isCloze(c) ? clozePrompt(c.front) : c.front)}</b> · ${esc(isCloze(c) ? clozeFilled(c.front) : c.back)}</li>`).join('')}</ul>` : '',
      ],
      buttons: `
        ${missedCards.length ? `<button type="button" class="btn-sketch btn-sketch--go" data-retry>retry the ${missedCards.length} I missed</button>` : ''}
        <button type="button" class="btn-sketch" data-again>new quiz</button>
        <a class="btn-plain" href="#/deck">back to the deck</a>`,
    });
    root.querySelector('.session').addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) {
        const questions = buildQuiz(deck, { mode: z.mode, direction: z.direction, count: 0, onlyIds: z.missed });
        Object.assign(z, { phase: 'ask', questions, i: 0, right: 0, missed: [], answered: null });
        renderQuiz(root);
      } else if (e.target.closest('[data-again]')) {
        z.phase = 'setup';
        renderQuiz(root);
      }
    });
    return;
  }

  const q = z.questions[z.i];
  const a = z.answered;
  root.innerHTML = `
  <div class="session">
    <div class="session__top">
      <a class="btn-plain btn-plain--muted" href="#/deck">stop</a>
      <p class="eyebrow">${z.i + 1} of ${z.questions.length} · ${z.right} right</p>
      <span class="spacer"></span>
    </div>
    <div class="flash flash--ask">${cardImg(q.img)}<span class="flash__front">${esc(q.ask)}</span>${q.note ? `<span class="flash__hint">${esc(q.note)}</span>` : ''}</div>
    ${q.kind === 'choice' ? `
      <div class="choices">${q.options.map((o, n) => `
        <button type="button" class="choice${a ? (o === q.answer ? ' is-right' : o === a.given ? ' is-wrong' : '') : ''}" data-choice="${n}"${a ? ' disabled' : ''}>${esc(o)}</button>`).join('')}
      </div>` : `
      <form class="typed" data-typed>
        <input name="answer" autocomplete="off" autocapitalize="off" spellcheck="false" ${a ? `value="${esc(a.given)}" disabled` : ''} placeholder="Type the answer">
        ${a ? '' : '<button type="submit" class="btn-sketch btn-sketch--go">check</button>'}
      </form>`}
    ${a ? `
      <p class="quiz-feedback ${a.ok ? 'is-right' : 'is-wrong'}">${a.ok ? 'Right!' : `Not quite. It's <b>${esc(q.answer)}</b>.`}</p>
      <div class="grade">
        ${!a.ok && q.kind === 'type' ? '<button type="button" class="btn-sketch" data-override>I was right</button>' : ''}
        <button type="button" class="btn-sketch btn-sketch--go" data-next>${z.i + 1 < z.questions.length ? 'next' : 'see score'}</button>
      </div>` : ''}
  </div>`;

  const answer = (given, ok) => {
    z.answered = { given, ok };
    if (ok) z.right++; else z.missed.push(q.cardId);
    play(ok ? 'pop' : 'stamp');
    renderQuiz(root);
  };
  const next = () => {
    z.answered = null;
    z.i++;
    if (z.i >= z.questions.length) {
      z.phase = 'done';
      saveQuizResult(deck.id, { score: z.right, total: z.questions.length, missed: z.missed });
    }
    renderQuiz(root);
  };
  const page = root.querySelector('.session');
  page.querySelector('[data-typed]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const given = e.target.answer.value;
    if (!given.trim()) { toast('Type an answer, or give it your best guess.'); return; }
    answer(given, q.answers?.length > 1 ? checkAny(given, q.answers) : checkTyped(given, q.answer));
  });
  page.querySelector('[data-typed] input:not([disabled])')?.focus();
  page.addEventListener('click', (e) => {
    const c = e.target.closest('[data-choice]');
    if (c && !a) { const given = q.options[Number(c.dataset.choice)]; answer(given, given === q.answer); return; }
    if (e.target.closest('[data-override]')) {
      z.right++;
      z.missed = z.missed.filter((id) => id !== q.cardId);
      z.answered = { ...a, ok: true };
      renderQuiz(root);
      return;
    }
    if (e.target.closest('[data-next]')) next();
  });
  document.onkeydown = (e) => {
    if (location.hash !== '#/quiz') { document.onkeydown = null; return; }
    if (z.answered && e.key === 'Enter') { e.preventDefault(); next(); }
    else if (!z.answered && q.kind === 'choice' && /^[1-4]$/.test(e.key) && q.options[Number(e.key) - 1] !== undefined) {
      const given = q.options[Number(e.key) - 1];
      answer(given, given === q.answer);
    }
  };
}