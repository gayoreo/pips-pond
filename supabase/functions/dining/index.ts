// Fetches UVM dining hours and daily menus from the Sodexo site and saves a trimmed copy in
// the dining_cache table, which the app reads. Runs from the database scheduler twice a day
// (needs the x-cron-secret header). Nothing here is per-user.
//
//   dining_cache key 'places'           every location: name, address, hours, menu ids
//   dining_cache key 'menu:YYYY-MM-DD'  that day's menus, by location slug
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = Deno.env.get('DINING_SITE') || 'https://uvmdining.sodexomyway.com';
const TZ = 'America/New_York';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; PipsPond/1.0)' };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- reading the Sodexo site ----------
async function pageState(path: string) {
  const html = await fetch(`${SITE}${path}`, { headers: UA }).then((r) => r.text());
  const i = html.indexOf('window.__PRELOADED_STATE__ =');
  if (i < 0) throw new Error(`No page data on ${path}`);
  const j = html.indexOf('</script>', i);
  return { html, state: JSON.parse(html.slice(i + 28, j).trim().replace(/;\s*$/, '')) };
}

function walk(o: unknown, fn: (x: Record<string, unknown>) => void) {
  if (!o || typeof o !== 'object') return;
  fn(o as Record<string, unknown>);
  for (const v of Object.values(o as Record<string, unknown>)) walk(v, fn);
}

// The menu service needs the public key the site's own script uses.
async function apiInfo(html: string) {
  const src = /src="(\/static\/js\/main\.[a-z0-9]+\.js)"/.exec(html)?.[1];
  if (!src) throw new Error('Could not find the site script');
  const js = await fetch(`${SITE}${src}`, { headers: UA }).then((r) => r.text());
  const m = /API_URL:"(https:\/\/api-prd\.sodexomyway\.net\/[^"]+)",API_KEY:"([^"]+)"/.exec(js);
  if (!m) throw new Error('Could not find the menu service details');
  return { url: m[1], key: m[2] };
}

const hm = (t: { hour?: string; minute?: string; period?: string } | undefined) => {
  if (!t?.hour) return '';
  let h = Number(t.hour) % 12;
  if ((t.period ?? '').toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(Number(t.minute ?? 0)).padStart(2, '0')}`;
};
const DAY = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 } as Record<string, number>;
type Slot = { start: string; end: string; allDay?: boolean; label?: string };
function cleanHours(list: unknown): { days: number[]; slots: Slot[] }[] {
  return (Array.isArray(list) ? list : []).map((row: any) => ({
    days: (row.days ?? []).map((d: string) => DAY[d]).filter((d: number | undefined) => d !== undefined),
    slots: (row.hours ?? []).map((h: any) => ({
      start: hm(h.startTime), end: hm(h.finishTime), allDay: String(h.allDay) === 'true', label: h.label || '',
    })).filter((s: Slot) => s.allDay || (s.start && s.end)),
  }));
}

async function readPlace(slug: string) {
  const { html, state } = await pageState(`/en-us/locations/${slug}`);
  let main: any = null;
  walk(state, (x) => { if (!main && x.slug !== undefined && x.openingHours) main = x; });
  if (!main) return null;
  let ids: { locationId?: string; menuId?: string } = {};
  walk(state, (x) => {
    const md = x.metadata as Record<string, string> | undefined;
    if (!ids.menuId && md?.menuId && md?.locationId) ids = { locationId: md.locationId, menuId: md.menuId };
  });
  const oh = main.openingHours ?? {};
  return {
    html,
    place: {
      slug,
      name: String(main.name ?? slug),
      address: typeof main.address === 'string' ? main.address
        : [main.address?.street, main.address?.city, main.address?.state].filter(Boolean).join(', '),
      phone: String(main.telephone ?? ''),
      standard: cleanHours(oh.standardHours),
      seasonal: (oh.seasonalHours ?? []).map((s: any) => ({
        from: String(s.from ?? '').slice(0, 10), to: String(s.to ?? '').slice(0, 10), rows: cleanHours(s.openingHours),
      })),
      locationId: ids.locationId ?? '',
      menuId: ids.menuId ?? '',
      url: `${SITE}/en-us/locations/${slug}`,
    },
  };
}

async function allSlugs() {
  const { state } = await pageState('/en-us/locations/');
  const slugs = new Set<string>();
  walk(state, (x) => {
    const m = typeof x.uri === 'string' ? /\/locations\/([a-z0-9'-]+)$/.exec(x.uri) : null;
    if (m && !['hours', 'map'].includes(m[1])) slugs.add(m[1]);
  });
  return [...slugs];
}

const yes = (v: unknown) => v === true || v === 'true';
function trimMenu(raw: unknown) {
  return (Array.isArray(raw) ? raw : []).map((meal: any) => ({
    meal: String(meal.name ?? ''),
    stations: (meal.groups ?? []).map((g: any) => ({
      name: String(g.name ?? ''),
      items: (g.items ?? []).map((it: any) => ({
        name: String(it.formalName ?? it.description ?? '').trim(),
        desc: it.description && it.description !== it.formalName ? String(it.description).slice(0, 160) : '',
        cal: String(it.calories ?? ''),
        ing: String(it.ingredients ?? '').toLowerCase().replace(/\s+/g, ' ').slice(0, 300),
        vegan: yes(it.isVegan), veg: yes(it.isVegetarian), plant: yes(it.isPlantBased), mindful: yes(it.isMindful),
        allergens: (it.allergens ?? []).map((a: any) => String(typeof a === 'string' ? a : a?.name ?? a?.allergen ?? '')).filter(Boolean),
      })).filter((it: { name: string }) => it.name),
    })).filter((s: { items: unknown[] }) => s.items.length),
  })).filter((m: { stations: unknown[] }) => m.stations.length);
}

const dateIn = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

async function refresh() {
  const slugs = await allSlugs();
  const places = [];
  let html = '';
  for (const slug of slugs) {
    try {
      const r = await readPlace(slug);
      if (r) { places.push(r.place); html ||= r.html; }
    } catch (err) { console.warn('Skipped', slug, err); }
  }
  if (!places.length) throw new Error('No dining locations found');
  const stamp = new Date().toISOString();
  await admin.from('dining_cache').upsert({ key: 'places', data: { places, site: SITE }, updated_at: stamp });

  const api = await apiInfo(html);
  const days = [0, 1, 2, 3, 4, 5, 6].map(dateIn); // a week, so the app still works offline
  let menus = 0;
  for (const day of days) {
    const byPlace: Record<string, unknown> = {};
    for (const p of places) {
      if (!p.locationId || !p.menuId) continue;
      try {
        const res = await fetch(`${api.url}data/menu/${p.locationId}/${p.menuId}?date=${day}`, {
          headers: { ...UA, 'API-Key': api.key, 'Content-Type': 'application/json' },
        });
        if (!res.ok) continue;
        const meals = trimMenu(await res.json());
        if (meals.length) { byPlace[p.slug] = meals; menus++; }
      } catch (err) { console.warn('Menu failed', p.slug, day, err); }
    }
    await admin.from('dining_cache').upsert({ key: `menu:${day}`, data: byPlace, updated_at: stamp });
  }
  // Keep a week of old menus at most.
  await admin.from('dining_cache').delete().like('key', 'menu:%').lt('key', `menu:${dateIn(-7)}`);
  return { places: places.length, menus };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return reply({ error: 'Not allowed.' }, 401);
  try {
    return reply(await refresh());
  } catch (err) {
    console.error(err);
    return reply({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
