// Optional Face ID / Touch ID / Windows Hello lock for this device.
// It uses the phone's built-in passkey check (WebAuthn), so the app never sees your face or fingerprint.
// It's a privacy screen for this device: you stay signed in underneath, so no password is needed.
import { frogSVG } from '../pip/frog.js';
import { esc } from './dom.js';

const KEY = 'pips-pond:lock';
const AWAY_MS = 5 * 60 * 1000; // lock again after 5 minutes in the background

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

function stored() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export const lockEnabled = () => Boolean(stored()?.id);

export async function lockSupported() {
  try {
    return Boolean(window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

// Asks for Face ID once to create a device-only key. Must be called from a tap.
export async function enableLock(label = 'Pip’s Pond') {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Pip’s Pond' },
      user: { id: random(16), name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Face ID was cancelled.');
  localStorage.setItem(KEY, JSON.stringify({ id: b64(cred.rawId) }));
}

export function disableLock() {
  localStorage.removeItem(KEY);
}

async function verify() {
  const { id } = stored();
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return Boolean(res);
}

let overlay = null;

export function showLock(frogName = 'Pip') {
  if (!lockEnabled() || overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'lock';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Pip’s Pond is locked');
  overlay.innerHTML = `
    <div class="lock__card">
      <div class="frog is-sleeping">${frogSVG('sleeping', frogName)}</div>
      <p class="hand lock__title">${esc(frogName)} is guarding the pond</p>
      <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-unlock>Unlock</button>
      <p class="lock__msg muted" aria-live="polite"></p>
      <button type="button" class="btn-plain btn-plain--muted" data-lock-off>Can’t use Face ID? Sign in instead</button>
    </div>`;
  document.body.append(overlay);
  document.body.classList.add('is-locked');
  const msg = overlay.querySelector('.lock__msg');
  const tryUnlock = async () => {
    msg.textContent = '';
    try {
      if (await verify()) hideLock();
    } catch {
      msg.textContent = 'That didn’t work. Tap Unlock to try again.';
    }
  };
  overlay.querySelector('[data-unlock]').addEventListener('click', tryUnlock);
  overlay.querySelector('[data-lock-off]').addEventListener('click', () => {
    window.dispatchEvent(new Event('pond:lock-fallback'));
  });
  overlay.querySelector('[data-unlock]').focus();
}

export function hideLock() {
  overlay?.remove();
  overlay = null;
  document.body.classList.remove('is-locked');
}

let hiddenAt = 0;
export function watchLock(getFrogName) {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (lockEnabled() && hiddenAt && Date.now() - hiddenAt > AWAY_MS) showLock(await getFrogName());
  });
}
