// Sign in with a username instead of an email.
// Looks up the email for the username (server-side, so emails stay private), then signs in normally.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });
const WRONG = { error: 'Wrong username or password.' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { username, password } = await req.json();
    const name = String(username ?? '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{3,20}$/.test(name) || typeof password !== 'string' || !password) return reply(WRONG);

    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(url, key, opts);

    const { data: profile } = await admin.from('profiles').select('id').eq('username', name).maybeSingle();
    if (!profile) return reply(WRONG);
    const { data: found } = await admin.auth.admin.getUserById(profile.id);
    const email = found?.user?.email;
    if (!email) return reply(WRONG);

    const { data, error } = await createClient(url, key, opts).auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      if (error?.message?.toLowerCase().includes('confirm')) return reply({ error: 'Confirm your email first (check your inbox).' });
      return reply(WRONG);
    }
    return reply({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch {
    return reply({ error: 'Something went wrong. Try again.' });
  }
});
