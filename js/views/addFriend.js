// Handles invite links: pips-pond/?add=A1B2C3 (from a friend's "share" button).
// The code is remembered until you're signed in, then the Friends page prefills it.
import { savePendingInvite } from '../data/auth.js';

const CODE_RE = /^[A-Za-z0-9_]{3,20}$/;

// Reads ?add= from the URL, saves it, and strips it from the address bar.
// Returns the code (or null). main.js decides where to send you next.
export function captureInvite(params) {
  const raw = (params.get('add') ?? '').trim();
  const code = raw.replace(/^@/, '');
  if (!code || !CODE_RE.test(code)) return null;
  savePendingInvite(code); // the server checks it as both a username and a friend code
  return code;
}
