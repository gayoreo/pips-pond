// Make an account (or finish setting one up after signing in with Google).
import {
  signUp, signInWithGoogle, afterSignIn, nextStop, usernameAvailable, setPassword, setUsername,
  markAccountSetupSeen, myProfile, userNow, USERNAME_RE,
} from '../data/auth.js';
import { getProfile, saveProfile, readAll } from '../data/db.js';
import { authHero, busy, showError, PREFILL_KEY } from './login.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { play } from '../ui/sound.js';

// Checks a username as you type (debounced), and shows a green tick / red note.
function wireUsernameCheck(input, note, { allowEmpty = false } = {}) {
  let timer;
  const check = async () => {
    const name = input.value.trim().toLowerCase();
    input.value = name;
    if (!name) { note.textContent = allowEmpty ? 'Optional — friends use this to find you.' : ''; note.className = 'field-note'; input.dataset.ok = allowEmpty ? '1' : ''; return; }
    if (!USERNAME_RE.test(name)) {
      note.textContent = '3–20 letters, numbers or _.';
      note.className = 'field-note is-bad';
      input.dataset.ok = '';
      return;
    }
    note.textContent = 'Checking…';
    note.className = 'field-note';
    input.dataset.ok = '';
    try {
      const free = await usernameAvailable(name);
      if (input.value.trim().toLowerCase() !== name) return; // changed while checking
      note.textContent = free ? '✓ available' : 'That one’s taken.';
      note.className = `field-note ${free ? 'is-good' : 'is-bad'}`;
      input.dataset.ok = free ? '1' : '';
    } catch {
      note.textContent = 'Couldn’t check right now.';
      note.className = 'field-note';
      input.dataset.ok = '1'; // let the server decide on submit
    }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 400); });
  return check;
}

export async function renderSignup(root) {
  const profile = await getProfile();
  root.innerHTML = `
  <div class="auth">
    ${authHero('happy', 'Yay, a new pond friend! Let’s make your account.')}
    <section class="card auth__card">
      <h1 class="page-title">Make an account</h1>
      <button type="button" class="btn-sketch btn-google" data-google>Continue with Google</button>
      <p class="or"><span>or</span></p>
      <form id="signup-form" class="stack" novalidate>
        <div class="grid-2">
          <label class="field">Your nickname<input name="nickname" maxlength="24" autocomplete="nickname" value="${esc(profile.nickname)}"></label>
          <label class="field">Frog’s name<input name="frogName" maxlength="24" autocomplete="off" value="${esc(profile.frogName || 'Pip')}"></label>
        </div>
        <label class="field">Username <span class="muted">(optional)</span>
          <input name="username" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. sam_frog">
        </label>
        <p class="field-note" data-user-note>Optional — friends use this to find you.</p>
        <label class="field">Email<input type="email" name="email" autocomplete="email" autocapitalize="none" required></label>
        <label class="field">Password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <p class="card__hint">At least 8 characters.</p>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn-sketch btn-sketch--go btn-sketch--big">Create account</button>
      </form>
    </section>
    <p class="auth__alt">Already have one? <a class="btn-plain" href="#/login">Sign in</a></p>
  </div>`;

  const form = root.querySelector('#signup-form');
  wireUsernameCheck(form.username, root.querySelector('[data-user-note]'), { allowEmpty: true });

  root.querySelector('[data-google]').addEventListener('click', async (e) => {
    try { await busy(e.currentTarget, 'Opening Google…', signInWithGoogle); }
    catch (err) { showError(root, err.message); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(root, '');
    const nickname = form.nickname.value.trim();
    const frogName = form.frogName.value.trim() || 'Pip';
    const username = form.username.value.trim().toLowerCase();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email.includes('@')) return showError(root, 'Enter a valid email.');
    if (password.length < 8) return showError(root, 'Use a password of at least 8 characters.');
    if (username && !USERNAME_RE.test(username)) return showError(root, 'Username: 3–20 letters, numbers or _.');
    if (username && form.username.dataset.ok !== '1') return showError(root, 'That username is taken — pick another.');

    // Save the names on this device now, so they're there whether or not email confirmation is on.
    await saveProfile({ nickname, frogName });
    const button = form.querySelector('[type="submit"]');
    try {
      const { session } = await busy(button, 'Creating…', () => signUp({ email, password, username, nickname, frogName }));
      play('ribbit');
      if (session) {
        location.hash = await afterSignIn(session.user);
      } else {
        // Email confirmation is on: they must click the link first.
        sessionStorage.setItem(PREFILL_KEY, email);
        renderCheckEmail(root, email);
      }
    } catch (err) {
      showError(root, err.message);
    }
  });
}

function renderCheckEmail(root, email) {
  root.innerHTML = `
  <div class="auth">
    ${authHero('sleeping', 'Almost there! I’ll nap until you confirm.')}
    <section class="card auth__card stack">
      <h1 class="page-title">Check your email</h1>
      <p>We sent a confirmation link to <b>${esc(email)}</b>. Open it in this same browser or app, then you’re in.</p>
      <p class="card__hint">No email after a minute? Check spam, or try signing in — it may already be active.</p>
      <a class="btn-sketch btn-sketch--go" href="#/login">Go to sign in</a>
    </section>
  </div>`;
}

// After Google sign-in on a fresh account: pick a username and (optionally) a password.
export async function renderFinishAccount(root) {
  const user = userNow();
  if (!user) { location.hash = '#/login'; return; }
  const profile = await myProfile().catch(() => null);
  if (profile?.username) { await markAccountSetupSeen(); location.hash = await nextStop(user); return; }
  const local = await getProfile();
  root.innerHTML = `
  <div class="auth">
    ${authHero('happy', 'One more thing — pick a name friends can find you by.')}
    <section class="card auth__card">
      <h1 class="page-title">Finish your account</h1>
      <form id="finish-form" class="stack" novalidate>
        <label class="field">Username <span class="muted">(optional)</span>
          <input name="username" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(profile?.username ?? '')}" placeholder="e.g. sam_frog">
        </label>
        <p class="field-note" data-user-note>Optional — friends use this to find you.</p>
        <label class="row"><span>Also set a password (so you can sign in without Google)</span>
          <input type="checkbox" class="switch" data-want-pw></label>
        <label class="field" data-pw hidden>Password<input type="password" name="password" autocomplete="new-password" minlength="8"></label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn-sketch btn-sketch--go btn-sketch--big">All set</button>
        <button type="button" class="btn-plain btn-plain--muted" data-skip>Skip for now</button>
      </form>
    </section>
  </div>`;

  const form = root.querySelector('#finish-form');
  wireUsernameCheck(form.username, root.querySelector('[data-user-note]'), { allowEmpty: true });
  const pwField = root.querySelector('[data-pw]');
  root.querySelector('[data-want-pw]').addEventListener('change', (e) => {
    pwField.hidden = !e.target.checked;
    if (e.target.checked) pwField.querySelector('input').focus();
  });

  const done = async () => { await markAccountSetupSeen(); location.hash = await nextStop(user); };
  root.querySelector('[data-skip]').addEventListener('click', done);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(root, '');
    const username = form.username.value.trim().toLowerCase();
    const wantPw = root.querySelector('[data-want-pw]').checked;
    const password = form.password.value;
    if (username && !USERNAME_RE.test(username)) return showError(root, 'Username: 3–20 letters, numbers or _.');
    if (username && form.username.dataset.ok !== '1') return showError(root, 'That username is taken — pick another.');
    if (wantPw && password.length < 8) return showError(root, 'Use a password of at least 8 characters.');
    try {
      await busy(form.querySelector('[type="submit"]'), 'Saving…', async () => {
        if (username) await setUsername(username);
        if (wantPw && password) await setPassword(password);
      });
      toast('Account ready!');
      await done();
    } catch (err) {
      showError(root, err.message);
    }
  });
}
