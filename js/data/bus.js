// Campus bus (UVM CATS). Live data comes from UVM's Peak Transit API via Supabase Edge Function proxy.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

// Base endpoints for proxy
const SUPABASE_PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/bus` : null;
const LOCAL_PROXY_URL = '/api/bus';

const CACHE_KEY = 'pips-pond:bus-static';
export const WALK_M_PER_MIN = 80;   // about 3 mph
const BUS_M_PER_MIN = 350;          // about 13 mph with stops and traffic
const DWELL_MIN = 0.4;              // time at each stop
export const DEFAULT_WALK = 4;      // minutes from a building to the stop you linked it to
export const BACKUP_WINDOW = 20;    // the second option has to leave within this many minutes

/**
 * Helper to call the bus proxy endpoint.
 * Supports calling Supabase Edge Function and falls back to local proxy.
 */
async function callBusProxy(endpoint, params = {}) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const query = new URLSearchParams({ endpoint: cleanEndpoint, ...params }).toString();
  const urls = [];
  if (SUPABASE_PROXY_URL) {
    urls.push(`${SUPABASE_PROXY_URL}?${query}`);
  }
  urls.push(`${LOCAL_PROXY_URL}?${query}`);

  let lastError = null;
  for (const url of urls) {
    try {
      const headers = { Accept: 'application/json' };
      if (SUPABASE_ANON_KEY && SUPABASE_URL && url.includes(SUPABASE_URL)) {
        headers.apikey = SUPABASE_ANON_KEY;
        headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    console.warn('[bus] Proxy request failed:', lastError);
  }
  return null;
}

/**
 * 1. Fetch active routes (/routes)
 * @returns {Promise<Array<{ id: string, name: string, color: string }>>}
 */
export async function fetchRoutes() {
  const res = await callBusProxy('/routes');
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.routes || res.data || []);
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    let color = r.color || r.route_color || r.routeColor || '';
    if (color && !color.startsWith('#') && !color.startsWith('var(')) {
      color = `#${color}`;
    }
    return {
      id: String(r.id ?? r.route_id ?? r.routeId ?? ''),
      name: String(r.name ?? r.route_name ?? r.routeName ?? r.title ?? r.short_name ?? 'Shuttle'),
      color: color || 'var(--green-fill)',
      stops: r.stops ?? [],
    };
  }).filter((r) => r.id && r.name);
}

/**
 * 2. Fetch stops for a selected route (/stops?route_id={id})
 * @param {string|number} routeId
 * @returns {Promise<Array<{ id: string, name: string, lat?: number, lon?: number }>>}
 */
export async function fetchStops(routeId) {
  if (!routeId) return [];
  const res = await callBusProxy('/stops', { route_id: String(routeId) });
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.stops || res.data || []);
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({
    id: String(s.id ?? s.stop_id ?? s.stopId ?? ''),
    name: String(s.name ?? s.stop_name ?? s.stopName ?? s.title ?? 'Bus Stop'),
    lat: Number(s.lat ?? s.latitude ?? 0),
    lon: Number(s.lon ?? s.longitude ?? s.lng ?? 0),
  })).filter((s) => s.id && s.name);
}

/**
 * 3. Fetch live arrival predictions for a selected stop (/predictions?stop_id={id})
 * @param {string|number} stopId
 * @returns {Promise<Array<{ min: number, vehicle: string, routeName: string, eta: string }>>}
 */
export async function fetchPredictions(stopId) {
  if (!stopId) return [];
  const res = await callBusProxy('/predictions', { stop_id: String(stopId) });
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.predictions || res.arrivals || res.data || []);
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    let min = 0;
    if (typeof p.min === 'number') min = p.min;
    else if (typeof p.minutes === 'number') min = p.minutes;
    else if (typeof p.eta_minutes === 'number') min = p.eta_minutes;
    else if (p.eta) {
      const diff = new Date(p.eta).getTime() - Date.now();
      min = Math.max(0, Math.round(diff / 60000));
    } else if (p.arrival_time) {
      const diff = new Date(p.arrival_time).getTime() - Date.now();
      min = Math.max(0, Math.round(diff / 60000));
    }
    return {
      min: Math.max(0, Math.round(min)),
      vehicle: String(p.vehicle_id ?? p.vehicle ?? p.bus ?? ''),
      routeName: String(p.route_name ?? p.routeName ?? p.route ?? ''),
      eta: String(p.eta ?? p.arrival_time ?? ''),
    };
  }).sort((a, b) => a.min - b.min);
}

// Aliases
export const getRoutes = fetchRoutes;
export const getStops = fetchStops;
export const getPredictions = fetchPredictions;

// ---------- geometry & trip planning helpers ----------
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
  return (stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ stop: s, m: meters(spot, s) }))
    .sort((a, b) => a.m - b.m).slice(0, n);
}

export const placeKey = (text) => String(text || '').toLowerCase().split(/\s+/)
  .filter((w) => w && !/\d/.test(w)).join(' ').trim();

function legsOf(route, byId) {
  const ids = route.stops ?? [];
  const legs = [];
  for (let i = 0; i < ids.length; i++) {
    const a = byId[ids[i]];
    const b = byId[ids[(i + 1) % ids.length]];
    legs.push(a && b ? meters(a, b) / BUS_M_PER_MIN + DWELL_MIN : 1);
  }
  return legs;
}

function rideMinutes(route, legs, from, to) {
  const n = (route.stops ?? []).length;
  if (from === to) return 0;
  if (to < from && route.loop === false) return null;
  let t = 0;
  for (let i = from; i !== to; i = (i + 1) % n) t += legs[i];
  return t;
}

const cycleMinutes = (route, legs) => (route.loop === false ? null : legs.reduce((s, x) => s + x, 0));

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
  const seen = new Map();
  for (const o of options.sort((a, b) => a.arriveIn - b.arriveIn || a.walk - b.walk)) {
    const key = `${o.routeId}|${o.vehicleId}|${o.pass}`;
    if (!seen.has(key)) seen.set(key, o);
  }
  return { options: [...seen.values()].sort((a, b) => a.arriveIn - b.arriveIn), missed };
}

export function pickTwo(plan) {
  const [best, ...rest] = plan.options;
  if (!best) return { best: null, backup: null };
  const backup = rest.find((o) => o.busIn <= BACKUP_WINDOW
    && !(o.routeId === best.routeId && o.vehicleId === best.vehicleId && o.pass === best.pass)) ?? null;
  return { best, backup };
}

export async function loadBus() {
  try {
    const routes = await fetchRoutes();
    if (!routes.length) {
      return { ok: false, reason: 'empty', routes: [], stops: [], vehicles: [], arrivals: [] };
    }
    return { ok: true, routes, stops: [], vehicles: [], arrivals: [], at: Date.now() };
  } catch (err) {
    return { ok: false, reason: 'error', routes: [], stops: [], vehicles: [], arrivals: [] };
  }
}
