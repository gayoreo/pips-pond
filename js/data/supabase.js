// The Supabase client, loaded only when accounts are turned on in config.js.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

let client = null;

export async function sb() {
  if (!cloudEnabled) throw new Error('Accounts aren’t turned on for this copy of the app.');
  if (!client) {
    const { createClient } = await import(LIB);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

let cachedUser = null;
export const userNow = () => cachedUser;

// The signed-in user, or null. Also finishes a sign-in that just came back from Google or an email link.
export async function currentUser() {
  if (!cloudEnabled) return null;
  try {
    const client = await sb();
    const { data } = await Promise.race([
      client.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    cachedUser = data.session?.user ?? null;
  } catch {
    // offline and the library isn't cached yet
    cachedUser = null;
  }
  return cachedUser;
}

export function setCachedUser(user) { cachedUser = user; }

// Turns a Supabase / network error into something friendly.
export function friendlyError(error) {
  const msg = String(error?.message ?? error ?? '');
  if (/fetch|network|Failed to load|offline/i.test(msg)) return 'You’re offline. Try again when you’re connected.';
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(msg)) return 'Confirm your email first (check your inbox).';
  if (/already registered|already exists/i.test(msg)) return 'That email already has an account. Try signing in.';
  if (/Password should be/i.test(msg)) return 'Pick a longer password (at least 8 characters).';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
  if (/duplicate key.*username/i.test(msg)) return 'That username is taken.';
  return msg || 'Something went wrong. Try again.';
}
