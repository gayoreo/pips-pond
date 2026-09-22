// Sends Pip's Pond push notifications. Three ways it gets called:
//   { cron: true }  every 15 minutes by the database scheduler (needs the x-cron-secret header):
//                   daily nudges, pace alerts and semester-end warnings
//   { ping: 123 }   by the app right after you send a friend a snack / cheer / visit / dance
//   { test: true }  by the "Send a test" button in Settings
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!, // mailto:you@your-email
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

type Message = { title: string; body: string; tag: string; url?: string };

// Sends to every device the person turned notifications on for. Returns how many got it.
async function pushTo(userId: string, msg: Message): Promise<number> {
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ url: './', ...msg }),
        { TTL: 6 * 60 * 60, urgency: 'normal' },
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('push failed', code, (err as Error).message);
    }
  }
  return sent;
}

async function userFrom(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user ?? null;
}

// ---------- dates in the person's own time zone ----------
function localNow(tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch {
    return localNow('America/New_York');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}` };
}
const dayNumber = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86400000;
const addHours = (hm: string, h: number) => {
  const [a, b] = hm.split(':').map(Number);
  const m = Math.min(a * 60 + b + h * 60, 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const money = (n: number) => `$${Math.max(0, n).toFixed(2)}`;
const swipes = (n: number) => `${n} swipe${n === 1 ? '' : 's'}`;

type Row = {
  user_id: string; tz: string; sent: Record<string, string>;
  prefs: { nudge?: boolean; nudgeTime?: string; pace?: boolean; semesterEnd?: boolean; frogName?: string; nickname?: string };
  semester: { name: string; start: string; end: string; daysOff: { from: string; to: string }[] } | null;
  snapshot: {
    weekStart: string; lastLogDay: string; pointsLeftWeek: number; swipesLeftWeek: number;
    pointsBalance: number; swipesBalance: number; pointsTotal: number; swipesTotal: number;
    pointsRollover: boolean; swipesRollover: boolean;
  } | null;
};

// Which reminders are due for one person right now (and what to remember so each goes out once).
function due(row: Row): { msg: Message; mark: Record<string, string> }[] {
  const out: { msg: Message; mark: Record<string, string> }[] = [];
  const { prefs, semester: sem, snapshot: snap, sent } = row;
  if (!sem || !snap) return out;
  const { date, hm } = localNow(row.tz);
  const frog = prefs.frogName || 'Pip';
  const inSemester = date >= sem.start && date <= sem.end;
  const dayOff = (sem.daysOff ?? []).some((d) => date >= d.from && date <= d.to);
  const leftovers = [
    snap.pointsTotal > 0 && snap.pointsBalance > 0.005 ? money(snap.pointsBalance) : '',
    snap.swipesTotal > 0 && snap.swipesBalance > 0 ? swipes(snap.swipesBalance) : '',
  ].filter(Boolean).join(' and ');

  // Daily nudge: nothing logged today by your reminder time (checked for 3 hours after it).
  const at = /^\d\d:\d\d$/.test(prefs.nudgeTime ?? '') ? prefs.nudgeTime! : '19:00';
  if (prefs.nudge !== false && inSemester && !dayOff && sent.nudge !== date &&
      hm >= at && hm < addHours(at, 3) && snap.lastLogDay !== date) {
    out.push({
      msg: { title: `${frog} is hungry!`, body: 'Nothing logged today yet. Tap to tell me what you ate.', tag: 'nudge' },
      mark: { nudge: date },
    });
  }

  // Pace alert: once a week, the morning after you go over this week's budget.
  const weekOk = snap.weekStart && dayNumber(date) - dayNumber(snap.weekStart) >= 0 && dayNumber(date) - dayNumber(snap.weekStart) < 7;
  const overPoints = snap.pointsTotal > 0 && snap.pointsLeftWeek < -0.5;
  const overSwipes = snap.swipesTotal > 0 && snap.swipesLeftWeek < 0;
  if (prefs.pace !== false && inSemester && weekOk && sent.pace !== snap.weekStart &&
      hm >= '09:00' && hm < '12:00' && (overPoints || overSwipes)) {
    const what = [overPoints ? `${money(-snap.pointsLeftWeek)} in points` : '', overSwipes ? swipes(-snap.swipesLeftWeek) : '']
      .filter(Boolean).join(' and ');
    out.push({
      msg: { title: `${frog} is a little worried`, body: `You’re ${what} over this week. Check today’s budget in the app.`, tag: 'pace' },
      mark: { pace: snap.weekStart },
    });
  }

  // Semester end: two weeks out (finals mode) and three days out.
  const daysLeft = dayNumber(sem.end) - dayNumber(date);
  if (prefs.semesterEnd !== false && hm >= '10:00' && hm < '20:00') {
    if (daysLeft <= 14 && daysLeft > 3 && sent.end14 !== sem.end) {
      out.push({
        msg: {
          title: 'Finals mode is on!',
          body: `${daysLeft} days left in ${sem.name}.${leftovers ? ` You still have ${leftovers}.` : ''}`,
          tag: 'semester',
        },
        mark: { end14: sem.end },
      });
    } else if (daysLeft <= 3 && daysLeft >= 0 && sent.end3 !== sem.end) {
      const loses = [
        snap.pointsTotal > 0 && snap.pointsBalance > 0.005 && !snap.pointsRollover ? money(snap.pointsBalance) : '',
        snap.swipesTotal > 0 && snap.swipesBalance > 0 && !snap.swipesRollover ? swipes(snap.swipesBalance) : '',
      ].filter(Boolean).join(' and ');
      out.push({
        msg: {
          title: daysLeft === 0 ? 'Last day of the semester!' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left!`,
          body: loses
            ? `${loses} won’t carry over, so spend it before it’s gone.`
            : leftovers ? `You have ${leftovers} left, and it carries over to next semester.` : `You made it through ${sem.name}!`,
          tag: 'semester',
        },
        mark: { end3: sem.end },
      });
    }
  }
  return out;
}

async function runCron() {
  const { data: subs } = await admin.from('push_subscriptions').select('user_id');
  const users = [...new Set((subs ?? []).map((s) => s.user_id))];
  let sent = 0;
  for (let i = 0; i < users.length; i += 200) {
    const { data: rows } = await admin.from('notify_state').select('*').in('user_id', users.slice(i, i + 200));
    for (const row of (rows ?? []) as Row[]) {
      const list = due(row);
      if (!list.length) continue;
      // Mark first so a slow run can't send the same reminder twice.
      const mark = Object.assign({}, ...list.map((d) => d.mark));
      await admin.from('notify_state').update({ sent: { ...row.sent, ...mark } }).eq('user_id', row.user_id);
      for (const d of list) sent += await pushTo(row.user_id, d.msg);
    }
  }
  return sent;
}

const PING_TEXT: Record<string, (who: string, theirFrog: string, yourFrog: string, note: string) => Message> = {
  snack: (who, theirFrog) => ({ title: `${who} sent ${theirFrog} a snack!`, body: `${theirFrog} is munching away.`, tag: 'friends' }),
  cheer: (who) => ({ title: `${who} is cheering for you!`, body: 'Open the app to see your pond.', tag: 'friends' }),
  visit: (who, _theirFrog, yourFrog) => ({ title: `${yourFrog} is visiting!`, body: `${who}’s frog hopped over to your pond.`, tag: 'friends' }),
  dance: (who, theirFrog, yourFrog) => ({ title: `${yourFrog} did a silly dance!`, body: `${who}’s frog is dancing for ${theirFrog}.`, tag: 'friends' }),
  study: (who, _theirFrog, _yourFrog, note) => ({ title: `${who} wants to study together`, body: note ? `How about ${note}?` : 'Open the app to answer.', tag: 'friends' }),
};

async function sendPing(req: Request, pingId: number) {
  const user = await userFrom(req);
  if (!user) return reply({ error: 'Sign in first.' }, 401);
  const { data: ping } = await admin.from('pings').select('id, sender, recipient, kind, note').eq('id', pingId).maybeSingle();
  if (!ping || ping.sender !== user.id) return reply({ error: 'Not found.' }, 404);
  const [{ data: state }, { data: people }] = await Promise.all([
    admin.from('notify_state').select('prefs').eq('user_id', ping.recipient).maybeSingle(),
    admin.from('profiles').select('id, nickname, username, frog_name').in('id', [ping.sender, ping.recipient]),
  ]);
  if (state?.prefs?.friends === false) return reply({ sent: 0 });
  const from = people?.find((p) => p.id === ping.sender);
  const to = people?.find((p) => p.id === ping.recipient);
  const who = from?.nickname || (from?.username ? `@${from.username}` : 'A friend');
  const text = PING_TEXT[ping.kind] ?? PING_TEXT.cheer;
  const msg = text(who, to?.frog_name || 'Pip', from?.frog_name || 'A frog', ping.note || '');
  return reply({ sent: await pushTo(ping.recipient, msg) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.cron) {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || req.headers.get('x-cron-secret') !== secret) return reply({ error: 'Not allowed.' }, 401);
      return reply({ sent: await runCron() });
    }
    if (body.ping) return await sendPing(req, Number(body.ping));
    if (body.test) {
      const user = await userFrom(req);
      if (!user) return reply({ error: 'Sign in first.' }, 401);
      const { data: p } = await admin.from('profiles').select('frog_name').eq('id', user.id).maybeSingle();
      const sent = await pushTo(user.id, { title: `Ribbit! ${p?.frog_name || 'Pip'} here.`, body: 'Notifications are working.', tag: 'test' });
      return reply(sent ? { sent } : { error: 'No devices have notifications turned on yet.' });
    }
    return reply({ error: 'Nothing to do.' }, 400);
  } catch (err) {
    console.error(err);
    return reply({ error: 'Something went wrong sending notifications.' }, 500);
  }
});
