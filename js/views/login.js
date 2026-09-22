// Sign in, reset password, and "which pond do we keep?" after signing in on a device that already had data.
import {
  signInWithGoogle, signInWithPassword, sendPasswordReset, afterSignIn, nextStop, setPassword, doneResetting,
  useLocalOnly, isLocalOnly, needsLogin, userNow, currentUser,
} from '../data/auth.js';
import { resolveClaim, syncNow } from '../data/sync.js';
import { readAll, exportAll } from '../data/db.js';
import { download } from '../data/importExport.js';
import { pondSceneHTML } from '../ui/widgets.js';
import { outfitFor } from '../pip/frog.js';
import { todayKey } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';

export const PREFILL_KEY = 'pond:login-prefill';

export function authHero(mood, line) {
  const name = readAll().profile?.frogName || 'Pip';
  return `
  <div class="auth__hero">
    ${pondSceneHTML({ mood, name, outfit: outfitFor(todayKey()), tag: false })}
    <p class="bubble" aria-live="polite">${esc(line)}</p>
  </div>`;
}

// Disables a button and shows "..." while `work` runs. Returns work's result.
export async function busy(button, label, work) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

export function showError(root, message) {
  const el = root.querySelector('.form-error');
  if (el) el.textContent = message;
  if (message) play('whoa');
}

export async function renderLogin(root) {
  const prefill = sessionStorage.getItem(PREFILL_KEY) ?? '';
  const locked = needsLogin();
  const hasLocalData = Boolean(readAll().settings);
  root.innerHTML = `
  <div class="auth">
    ${authHero('happy', locked ? 'Sign in again to open the pond.' : 'Hi! Sign in so I can find your pond on any device.')}
    <section class="card auth__card">
      <h1 class="page-title">Sign in</h1>
      <button type="button" class="btn-sketch btn-google" data-google>Continue with Google</button>
      <p class="or"><span>or</span></p>
      <form id="login-form" class="stack" novalidate>
        <label class="field">Email or username<input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(prefill)}"></label>
        <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn-sketch btn-sketch--go btn-sketch--big">Sign in</button>
      </form>
      <button type="button" class="btn-plain" data-forgot aria-expanded="false">Forgot password?</button>
      <form id="forgot-form" class="stack" hidden novalidate>
        <label class="field">Your account’s email<input type="email" name="email" autocomplete="email" autocapitalize="none" required></label>
        <button type="submit" class="btn-sketch">Email me a reset link</button>
        <p class="card__hint">Open the link in this same browser or app.</p>
      </form>
    </section>
    <p class="auth__alt">New here? <a class="btn-plain" href="#/signup">Make an account</a></p>
    ${locked ? '' : `<button type="button" class="btn-plain btn-plain--muted auth__skip" data-local>${
      isLocalOnly() || hasLocalData ? 'Back to my pond (no account)' : 'Use without an account'}</button>`}
  </div>`;
  sessionStorage.removeItem(PREFILL_KEY);

  const form = root.querySelector('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const login = form.login.value.trim();
    const password = form.password.value;
    if (!login || !password) return showError(root, 'Type your email (or username) and password.');
    showError(root, '');
    const button = form.querySelector('[type="submit"]');
    try {
      const to = await busy(button, 'Signing in…', async () => afterSignIn(await signInWithPassword(login, password)));
      play('ribbit');
      location.hash = to;
    } catch (err) {
      showError(root, err.message);
    }
  });

  root.querySelector('[data-google]').addEventListener('click', async (e) => {
    try {
      await busy(e.currentTarget, 'Opening Google…', signInWithGoogle);
    } catch (err) {
      showError(root, err.message);
    }
  });

  const forgot = root.querySelector('#forgot-form');
  root.querySelector('[data-forgot]').addEventListener('click', (e) => {
    forgot.hidden = !forgot.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!forgot.hidden));
    if (!forgot.hidden) {
      if (form.login.value.includes('@')) forgot.email.value = form.login.value.trim();
      forgot.email.focus();
    }
  });
  forgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = forgot.email.value.trim();
    if (!email.includes('@')) return toast('Type the email you signed up with.');
    try {
      await busy(forgot.querySelector('button'), 'Sending…', () => sendPasswordReset(email));
      toast('Sent! Check your email for the reset link.', 4000);
      forgot.hidden = true;
    } catch (err) {
      toast(err.message, 4000);
    }
  });

  root.querySelector('[data-local]')?.addEventListener('click', () => {
    useLocalOnly();
    location.hash = readAll().settings ? '#/pond' : '#/welcome';
  });
}

// After a "reset your password" email link.
export async function renderResetPassword(root) {
  const user = userNow() ?? await currentUser();
  if (!user) { doneResetting(); location.hash = '#/login'; return; }
  root.innerHTML = `
  <div class="auth">
    ${authHero('happy', 'Let’s pick a new password.')}
    <section class="card auth__card">
      <h1 class="page-title">New password</h1>
      <form id="reset-form" class="stack" novalidate>
        <label class="field">New password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field">Type it again<input type="password" name="again" autocomplete="new-password" minlength="8" required></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn-sketch btn-sketch--go btn-sketch--big">Save password</button>
      </form>
    </section>
  </div>`;
  const form = root.querySelector('#reset-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.password.value.length < 8) return showError(root, 'Use at least 8 characters.');
    if (form.password.value !== form.again.value) return showError(root, 'The two passwords don’t match.');
    try {
      await busy(form.querySelector('button'), 'Saving…', () => setPassword(form.password.value));
      doneResetting();
      toast('Password changed!');
      location.hash = await afterSignIn(user);
    } catch (err) {
      showError(root, err.message);
    }
  });
}

// This device had a pond before signing in, and so does the account.
export async function renderMerge(root) {
  const user = userNow();
  if (!user) { location.hash = '#/login'; return; }
  const local = readAll();
  root.innerHTML = `
  <div class="auth">
    ${authHero('shocked', 'Whoa, two ponds! Which one should I live in?')}
    <section class="card auth__card stack">
      <h1 class="page-title">This device already has a pond</h1>
      <p>Your account has a pond too. Pick which one to keep. The other one is replaced everywhere.</p>
      <button type="button" class="btn-sketch btn-sketch--go" data-keep="cloud">Use my account’s pond</button>
      <p class="card__hint">Recommended if you’ve been using the app on another device. This device’s ${
        esc(local.settings?.semesterName ?? 'data')} is replaced.</p>
      <button type="button" class="btn-sketch" data-keep="device">Keep this device’s pond</button>
      <p class="card__hint">Replaces your account’s pond (on every device) with this one.</p>
      <button type="button" class="btn-plain" data-backup>Download this device’s data first</button>
    </section>
  </div>`;
  root.querySelector('.auth').addEventListener('click', async (e) => {
    if (e.target.closest('[data-backup]')) {
      download(`pips-pond-this-device-${todayKey()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json');
      return;
    }
    const keep = e.target.closest('[data-keep]')?.dataset.keep;
    if (!keep) return;
    if (keep === 'device' && !confirm('Replace the pond saved in your account with this device’s pond?')) return;
    resolveClaim(user.id, keep);
    // Same reasoning as afterSignIn(): wait for the real sync rather than racing a timeout,
    // so nextStop() doesn't route off of settings that haven't finished being pulled down yet.
    await busy(e.target.closest('button'), 'One sec…', () => syncNow());
    location.hash = await nextStop(user);
  });
}
