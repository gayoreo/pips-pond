// Sharing a deck: publish a copy under a short code, and copy a friend's deck into your own.
// The copy someone imports is theirs: their own review progress, their own edits.
import { sb, userNow, friendlyError } from './supabase.js';
import { getDeck, addDeck, addCards } from './decks.js';

const PENDING = 'pips-pond:deck-code';
export const savePendingShare = (code) => { try { sessionStorage.setItem(PENDING, String(code).trim().toUpperCase()); } catch { /* ignore */ } };
export const pendingShare = () => { try { return sessionStorage.getItem(PENDING) || ''; } catch { return ''; } };
export const clearPendingShare = () => { try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ } };

async function call(fn, args) {
  const { data, error } = await (await sb()).rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

// Cards only: no review progress, no quiz scores.
const packDeck = (deck) => ({
  cards: deck.cards.map((c) => ({ front: c.front, back: c.back, type: c.type ?? 'basic', both: Boolean(c.both), img: c.img || '' })),
});

export const shareSize = (deck) => JSON.stringify(packDeck(deck)).length;
export const SHARE_LIMIT = 700_000; // about 700 KB, mostly pictures

export async function shareDeck(deckId, existingCode = null) {
  const deck = getDeck(deckId);
  if (!deck) throw new Error('That deck is gone.');
  if (!userNow()) throw new Error('Sign in to share a deck.');
  if (!deck.cards.length) throw new Error('Add some cards first.');
  if (shareSize(deck) > SHARE_LIMIT) throw new Error('This deck is too big to share. Try removing some pictures.');
  return call('share_deck', { deck_name: deck.name, payload: packDeck(deck), card_count: deck.cards.length, existing: existingCode });
}

export const myShares = () => call('my_shared_decks');
export const unshareDeck = (code) => call('unshare_deck', { code });

export async function fetchShared(code) {
  const rows = await call('get_shared_deck', { code: String(code).trim().toUpperCase() });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error('No deck found with that code.');
  return row;
}

// Makes your own copy of a shared deck.
export function importShared(row, courseId = '') {
  const deck = addDeck({ name: row.name, courseId });
  const cards = (row.data?.cards ?? []).filter((c) => c.front && (c.back || c.type === 'cloze'));
  addCards(deck.id, cards);
  return { deck, count: cards.length };
}