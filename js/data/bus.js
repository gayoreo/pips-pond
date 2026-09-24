// Campus bus (UVM CATS). Live data comes from UVM's bus map, which runs on Peak Transit.
// fetchFeed() is the one piece still to fill in once we've seen how that map loads its data.
// Everything else works on this tidy shape:
//   stops:    [{ id, name, lat, lon }]
//   routes:   [{ id, name, color, stops: [stopId, ...] in driving order, loop: true|false }]
//   vehicles: [{ id, routeId, lat, lon }]
//   arrivals: [{ stopId, routeId, vehicleId, min }]   optional: predicted minutes until a bus reaches a stop.
//             Without them, arrivals are estimated from where each bus is on its route.
const CACHE_KEY = 'pips-pond:bus-static';

export const WALK_M_PER_MIN = 80;   // about 3 mph
const BUS_M_PER_MIN = 350;          // about 13 mph with stops and traffic
const DWELL_MIN = 0.4;              // time at each stop
export const DEFAULT_WALK = 4;      // minutes from a building to the stop you linked it to
export const BACKUP_WINDOW = 20;    // the second option has to leave within this many minutes

// ---------- the feed ----------
let testFeed = null;
export const setTestFeed = (feed) => { testFeed = feed; }; // for checking the math without live data

async function fetchFeed() {
  if (testFeed) return testFeed;
  // TODO(bus): read UVM's CATS map (uvm.rider.peaktransit.com) and return
  // { stops, routes, vehicles, arrivals } in the shape above.
  return null;
}

function readStatic() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

// { ok, reason?: 'not-connected' | 'error', stops, routes, vehicles, arrivals, at }
export async function loadBus() {
  const cached = readStatic();
  const fallback = { stops: cached?.stops ?? [], routes: cached?.routes ?? [], vehicles: [], arrivals: [] };
  try {
    const f = await fetchFeed();
    if (!f) return { ok: false, reason: 'not-connected', ...fallback };
    const feed = { stops: f.stops ?? [], routes: f.routes ?? [], vehicles: f.vehicles ?? [], arrivals: f.arrivals ?? [] };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ stops: feed.stops, routes: feed.routes })); } catch { /* full */ }
    return { ok: true, ...feed, at: Date.now() };
  } catch (err) {
    console.warn('bus feed', err);
    return { ok: false, reason: 'error', ...fallback };
  }
}

// ---------- geometry ----------
export function meters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const walkMinutes = (m) => Math.max(1, Math.ceil(m / WALK_M_PER_MIN));

export function nearestStops(stops, spot, n = 3) {
  return stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ stop: s, m: meters(spot, s) }))
    .sort((a, b) => a.m - b.m).slice(0, n);
}

// "Innov E423" -> "innov", "Terrill Hall 309B" -> "terrill hall": the building, without the room.
export const placeKey = (text) => String(text || '').toLowerCase().split(/\s+/)
  .filter((w) => w && !/\d/.test(w)).join(' ').trim();

// ---------- routes ----------
function legsOf(route, byId) {
  const ids = route.stops ?? [];
  const legs = [];
  for (let i = 0; i < ids.length; i++) {
    const a = byId[ids[i]];
    const b = byId[ids[(i + 1) % ids.length]];
    legs.push(a && b ? meters(a, b) / BUS_M_PER_MIN + DWELL_MIN : 1);
  }
  return legs; // legs[i] = minutes from stop i to stop i+1 (the last one wraps around on a loop)
}

// Minutes riding from position `from` to position `to` along the route, or null if it can't go that way.
function rideMinutes(route, legs, from, to) {
  const n = (route.stops ?? []).length;
  if (from === to) return 0;
  if (to < from && route.loop === false) return null;
  let t = 0;
  for (let i = from; i !== to; i = (i + 1) % n) t += legs[i];
  return t;
}

const cycleMinutes = (route, legs) => (route.loop === false ? null : legs.reduce((s, x) => s + x, 0));

// Where a bus is on its route: the position of the stop it's closest to.
function vehicleIndex(route, byId, v) {
  let best = 0;
  let bestM = Infinity;
  (route.stops ?? []).forEach((id, i) => {
    const s = byId[id];
    if (!s) return;
    const m = meters(v, s);
    if (m < bestM) { bestM = m; best = i; }
  });
  return best;
}

// Buses coming to one stop on one route, soonest first, looking about 45 minutes ahead:
// [{ min, vehicleId, pass }] where pass 0 is its next time around and pass 1 the one after.
function arrivalsAt(feed, route, stopId, byId, legs) {
  const listed = (feed.arrivals ?? []).filter((a) => a.stopId === stopId && a.routeId === route.id && Number.isFinite(a.min));
  const cycle = cycleMinutes(route, legs);
  const base = listed.length
    ? listed.map((a) => ({ min: Math.max(0, a.min), vehicleId: a.vehicleId ?? '' }))
    : (feed.vehicles ?? []).filter((v) => v.routeId === route.id).map((v) => {
      const at = vehicleIndex(route, byId, v);
      const to = route.stops.indexOf(stopId);
      const min = rideMinutes(route, legs, at, to);
      return min === null ? null : { min, vehicleId: v.id };
    }).filter(Boolean);
  const out = [];
  for (const a of base) {
    out.push({ ...a, pass: 0 });
    if (cycle) for (let k = 1; a.min + k * cycle <= 45; k++) out.push({ ...a, min: a.min + k * cycle, pass: k });
  }
  return out.sort((x, y) => x.min - y.min);
}

// ---------- planning a trip ----------
// from: [{ stopId, walk }] stops you could walk to and how long each takes.
// to:   [stopId] stops that get you where you're going.
// Returns { options, missed } where options are catchable trips sorted by when you'd arrive:
//   { routeId, routeName, color, boardStopId, boardStop, alightStopId, alightStop, busIn, walk,
//     leaveIn, ride, arriveIn, vehicleId, busNear, stopsAway, pass }
// and missed is the soonest bus you can't make in time (to explain why the first option is later).
export function planTrip(feed, { from, to }) {
  const byId = Object.fromEntries((feed.stops ?? []).map((s) => [s.id, s]));
  const options = [];
  let missed = null;
  for (const route of feed.routes ?? []) {
    const ids = route.stops ?? [];
    const legs = legsOf(route, byId);
    const vehicles = Object.fromEntries((feed.vehicles ?? []).filter((v) => v.routeId === route.id).map((v) => [v.id, v]));
    for (const o of from) {
      const oi = ids.indexOf(o.stopId);
      if (oi < 0) continue;
      for (const d of to) {
        const di = ids.indexOf(d);
        if (di < 0 || di === oi) continue;
        const ride = rideMinutes(route, legs, oi, di);
        if (ride === null) continue;
        for (const a of arrivalsAt(feed, route, o.stopId, byId, legs)) {
          const v = vehicles[a.vehicleId];
          const vi = v ? vehicleIndex(route, byId, v) : null;
          const opt = {
            routeId: route.id, routeName: route.name, color: route.color || '',
            boardStopId: o.stopId, boardStop: byId[o.stopId]?.name ?? o.stopId,
            alightStopId: d, alightStop: byId[d]?.name ?? d,
            busIn: Math.round(a.min), walk: o.walk, leaveIn: Math.floor(a.min - o.walk),
            ride: Math.round(ride), arriveIn: Math.round(a.min + ride),
            vehicleId: a.vehicleId, pass: a.pass,
            busNear: vi === null ? '' : byId[ids[vi]]?.name ?? '',
            stopsAway: vi === null ? null : (oi - vi + ids.length) % ids.length,
          };
          if (o.walk <= a.min) options.push(opt);
          else if (!missed || opt.busIn < missed.busIn) missed = opt;
        }
      }
    }
  }
  // One entry per actual bus pass: keep whichever stop pair gets you there soonest.
  const seen = new Map();
  for (const o of options.sort((a, b) => a.arriveIn - b.arriveIn || a.walk - b.walk)) {
    const key = `${o.routeId}|${o.vehicleId}|${o.pass}`;
    if (!seen.has(key)) seen.set(key, o);
  }
  return { options: [...seen.values()].sort((a, b) => a.arriveIn - b.arriveIn), missed };
}

// The best trip plus a backup that leaves within BACKUP_WINDOW minutes and isn't the same bus.
export function pickTwo(plan) {
  const [best, ...rest] = plan.options;
  if (!best) return { best: null, backup: null };
  const backup = rest.find((o) => o.busIn <= BACKUP_WINDOW
    && !(o.routeId === best.routeId && o.vehicleId === best.vehicleId && o.pass === best.pass)) ?? null;
  return { best, backup };
}