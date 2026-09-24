// Campus bus (UVM CATS). Live data comes from UVM's Peak Transit API via Supabase Edge Function proxy.
import { SUPABASE_URL } from '../config.js';

export const DEFAULT_WALK = 5;
export const BACKUP_WINDOW = 20;

const PROXY_BASE = `${SUPABASE_URL}/functions/v1/bus`;

/**
 * Helper to call the Supabase Edge Function proxy.
 * Falls back to local proxy endpoints if remote Supabase function is unreachable.
 */
async function callProxy(path = '', params = {}) {
  const query = new URLSearchParams(params).toString();
  const queryString = query ? `?${query}` : '';
  const cleanPath = path ? path.replace(/^\/+/, '') : '';

  const urls = [
    `${PROXY_BASE}${cleanPath ? `/${cleanPath}` : ''}${queryString}`,
    `/functions/v1/bus${cleanPath ? `/${cleanPath}` : ''}${queryString}`,
    `/api/bus?endpoint=/${cleanPath}${query ? `&${query}` : ''}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Continue to next fallback URL
    }
  }

  return null;
}

/**
 * Normalizes building or place names into uniform dictionary keys
 * (e.g. "Davis Center" -> "daviscenter", "Votey Hall 205" -> "voteyhall205")
 * @param {string} name
 * @returns {string}
 */
export function placeKey(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Estimates walking time in minutes based on distance.
 * Handles distance in meters or kilometers.
 * Standard campus walking pace: ~80 meters per minute (~4.8 km/h or 3 mph).
 * @param {number} distance
 * @returns {number}
 */
export function walkMinutes(distance) {
  if (!distance || distance <= 0) return 0;
  // If distance is very small (< 30), assume it's in kilometers and convert to meters
  const meters = distance < 30 ? distance * 1000 : distance;
  return Math.max(1, Math.round(meters / 80));
}

/**
 * Haversine formula to compute distance in meters between two lat/lon coordinates
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Finds nearest bus stops to a given coordinate using Haversine formula.
 * Returns stops sorted by walking distance with stopId and walk (minutes) attached.
 * @param {Array} stops
 * @param {{ lat: number, lon?: number, lng?: number }} coord
 * @param {number} count
 * @returns {Array}
 */
export function nearestStops(stops = [], coord = {}, count = 3) {
  if (!Array.isArray(stops) || !coord) return [];
  const targetLat = Number(coord.lat);
  const targetLon = Number(coord.lon ?? coord.lng);
  if (isNaN(targetLat) || isNaN(targetLon)) return [];

  const scored = stops
    .filter((s) => s && s.lat != null && (s.lng != null || s.lon != null))
    .map((s) => {
      const sLat = Number(s.lat);
      const sLon = Number(s.lng ?? s.lon);
      const dist = haversineMeters(targetLat, targetLon, sLat, sLon);
      const walk = walkMinutes(dist);
      return {
        ...s,
        stopId: String(s.id ?? s.stopId ?? s.stopID),
        distance: Math.round(dist),
        walk,
      };
    })
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, count);
}

/**
 * Fetches all routes, stops, and live ETAs from Supabase proxy.
 * Passes query parameters forcing the Peak Transit v5 API.
 * Returns { ok: true, at: Date.now(), stops, routes }
 * @returns {Promise<{ ok: boolean, at: number, stops: Array, routes: Array, error?: string }>}
 */
export async function loadBus() {
  try {
    // 1. Request unified feed with v5 query parameter
    const feed = await callProxy('feed?v5=1');
    if (feed && feed.ok && Array.isArray(feed.stops) && Array.isArray(feed.routes)) {
      return feed;
    }

    // Secondary proxy URL format
    const altFeed = await callProxy('', { feed: '1', v5: '1' });
    if (altFeed && altFeed.ok && Array.isArray(altFeed.stops) && Array.isArray(altFeed.routes)) {
      return altFeed;
    }

    // 2. Client-side fallback: assemble routes, stops, and predictions
    const [routes, stops, preds] = await Promise.all([
      fetchRoutes({ v5: '1' }),
      fetchStops(null, { v5: '1' }),
      fetchPredictions(null, { v5: '1' }),
    ]);

    const stopsMap = new Map();
    for (const s of stops) {
      stopsMap.set(String(s.id), { ...s, etas: [] });
    }

    const routesMap = new Map();
    for (const r of routes) {
      routesMap.set(String(r.id), { ...r, stops: r.stops || [], etas: {} });
    }

    for (const p of preds) {
      const sId = String(p.stopId || '');
      const rId = String(p.routeId || '');
      if (sId && stopsMap.has(sId)) {
        stopsMap.get(sId).etas.push(p);
      }
      if (rId && routesMap.has(rId) && sId) {
        const rObj = routesMap.get(rId);
        if (!rObj.etas[sId]) rObj.etas[sId] = [];
        rObj.etas[sId].push(p);
      }
    }

    return {
      ok: true,
      at: Date.now(),
      stops: Array.from(stopsMap.values()),
      routes: Array.from(routesMap.values()),
    };
  } catch (err) {
    console.error('[loadBus] Failed to load transit feed:', err);
    return {
      ok: false,
      at: Date.now(),
      stops: [],
      routes: [],
      error: String(err),
    };
  }
}

/**
 * Plans A-to-B transit trips from origin stop candidates to destination stops.
 * Checks loop direction to ensure the destination stop comes after origin.
 *
 * @param {{ stops: Array, routes: Array }} feed
 * @param {{ from: Array<{ stopId: string|number, walk?: number }>, to: Array<string|number> }} options
 * @returns {Array} List of possible trips sorted by arrival time
 */
export function planTrip(feed, { from = [], to = [] } = {}) {
  if (!feed || !Array.isArray(feed.routes) || !Array.isArray(feed.stops)) {
    return [];
  }

  const fromList = Array.isArray(from) ? from : [from];
  const toList = (Array.isArray(to) ? to : [to])
    .map((item) => String(item?.stopId ?? item?.id ?? item))
    .filter(Boolean);

  if (fromList.length === 0 || toList.length === 0) {
    return [];
  }

  const stopsMap = new Map();
  for (const s of feed.stops) {
    stopsMap.set(String(s.id ?? s.stopId), s);
  }

  const trips = [];

  for (const fromCandidate of fromList) {
    const originStopId = String(fromCandidate.stopId ?? fromCandidate.id ?? fromCandidate);
    const walk = Number(fromCandidate.walk ?? fromCandidate.walkMinutes ?? DEFAULT_WALK);
    const boardStop = stopsMap.get(originStopId);
    if (!boardStop) continue;

    for (const destStopId of toList) {
      if (originStopId === destStopId) continue;
      const alightStop = stopsMap.get(destStopId);
      if (!alightStop) continue;

      for (const route of feed.routes) {
        const routeStops = (route.stops || []).map(String);
        if (routeStops.length === 0) continue;

        // Find all occurrences of origin and destination stops along this route
        const fromIndices = [];
        const toIndices = [];
        routeStops.forEach((id, idx) => {
          if (id === originStopId) fromIndices.push(idx);
          if (id === destStopId) toIndices.push(idx);
        });

        if (fromIndices.length === 0 || toIndices.length === 0) continue;

        // Find minimum forward loop distance from origin to destination
        let minDist = Infinity;
        const N = routeStops.length;

        for (const oi of fromIndices) {
          for (const di of toIndices) {
            if (di > oi) {
              const d = di - oi;
              if (d < minDist) minDist = d;
            } else if (di < oi) {
              // Loop wrap-around
              const d = (N - oi) + di;
              if (d < minDist) minDist = d;
            }
          }
        }

        if (minDist === Infinity || minDist <= 0 || minDist >= N) {
          continue;
        }

        // Estimated transit ride time: ~1.8 mins per stop, minimum 2 mins
        const rideMinutes = Math.max(2, Math.round(minDist * 1.8));

        // Gather live arrival ETAs for this route at the boarding stop
        let etas = [];
        if (route.etas && route.etas[originStopId]) {
          etas = route.etas[originStopId];
        } else if (Array.isArray(boardStop.etas)) {
          etas = boardStop.etas.filter((e) => String(e.routeId) === String(route.id));
        }

        for (const eta of etas) {
          const busIn = Math.max(0, Math.round(Number(eta.min ?? 0)));
          const leaveIn = busIn - walk;
          const arriveIn = busIn + rideMinutes;

          trips.push({
            route: {
              id: route.id,
              name: route.name,
              color: route.color || 'var(--green-fill)',
            },
            routeName: route.name,
            routeColor: route.color || 'var(--green-fill)',
            vehicle: String(eta.vehicle || ''),
            eta: String(eta.eta || ''),
            busIn,
            leaveIn,
            arriveIn,
            rideMinutes,
            walk,
            stopsCount: minDist,
            boardStop,
            alightStop,
          });
        }
      }
    }
  }

  // Sort trips: first by earliest arrival, then by earliest departure
  return trips.sort((a, b) => {
    if (a.arriveIn !== b.arriveIn) return a.arriveIn - b.arriveIn;
    return a.leaveIn - b.leaveIn;
  });
}

/**
 * Returns the best trip and a secondary backup option within BACKUP_WINDOW minutes.
 * @param {Array} trips
 * @returns {{ best: Object|null, backup: Object|null }}
 */
export function pickTwo(trips = []) {
  if (!Array.isArray(trips) || trips.length === 0) {
    return { best: null, backup: null };
  }

  // Prefer trips where user can make it (leaveIn >= -1 gives a brisk walk allowance)
  const viable = trips.filter((t) => t.leaveIn >= -1);
  const candidates = viable.length > 0 ? viable : trips;

  const sorted = [...candidates].sort((a, b) => {
    if (a.arriveIn !== b.arriveIn) return a.arriveIn - b.arriveIn;
    return a.leaveIn - b.leaveIn;
  });

  const best = sorted[0] || null;
  if (!best) return { best: null, backup: null };

  let backup = null;
  for (let i = 1; i < sorted.length; i++) {
    const candidate = sorted[i];
    const diff = candidate.leaveIn - best.leaveIn;
    if (diff >= 0 && diff <= BACKUP_WINDOW) {
      backup = candidate;
      break;
    }
  }

  if (!backup && sorted.length > 1) {
    const second = sorted[1];
    if (second.leaveIn - best.leaveIn <= BACKUP_WINDOW + 10) {
      backup = second;
    }
  }

  return { best, backup };
}

// -------------------------------------------------------------
// Backwards-compatible exports for existing view & test code
// -------------------------------------------------------------

export async function fetchRoutes(params = {}) {
  const res = await callProxy('routes', params);
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.routes || res.data || []);
  if (!Array.isArray(raw)) return [];

  return raw.map((r) => {
    let color = r.color || r.route_color || r.routeColor || '';
    if (color && !color.startsWith('#') && !color.startsWith('var(')) {
      color = `#${color}`;
    }
    return {
      id: String(r.id ?? r.route_id ?? r.routeID ?? ''),
      name: String(r.name ?? r.route_name ?? r.routeName ?? r.title ?? r.short_name ?? 'Shuttle Route'),
      color: color || 'var(--green-fill)',
      stops: r.stops || [],
    };
  }).filter((r) => r.id && r.name);
}

export async function fetchStops(routeId = null, params = {}) {
  const query = routeId ? { route_id: String(routeId), ...params } : params;
  const res = await callProxy('stops', query);
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.stops || res.data || []);
  if (!Array.isArray(raw)) return [];

  return raw.map((s) => ({
    id: String(s.id ?? s.stop_id ?? s.stopID ?? ''),
    name: String(s.name ?? s.stop_name ?? s.stopName ?? s.title ?? 'Bus Stop'),
    code: String(s.code ?? s.stop_code ?? s.stopCode ?? ''),
    lat: s.lat,
    lng: s.lng,
    lon: s.lng,
  })).filter((s) => s.id && s.name);
}

export async function fetchPredictions(stopId = null, params = {}) {
  const query = stopId ? { stop_id: String(stopId), ...params } : params;
  const res = await callProxy('predictions', query);
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.predictions || res.arrivals || res.data || []);
  if (!Array.isArray(raw)) return [];

  return raw.map((p) => {
    const rawMin = p.eta_minutes ?? p.minutes ?? p.min;
    let min = Number(rawMin);
    if (isNaN(min) || min < 0) {
      if (p.eta) {
        const diff = new Date(p.eta).getTime() - Date.now();
        min = Math.max(0, Math.round(diff / 60000));
      } else {
        min = 0;
      }
    } else {
      min = Math.round(min);
    }

    let color = p.color || p.route_color || p.routeColor || '';
    if (color && !color.startsWith('#') && !color.startsWith('var(')) {
      color = `#${color}`;
    }

    return {
      routeName: String(p.routeName ?? p.route_name ?? p.route ?? p.name ?? 'Shuttle'),
      routeId: String(p.routeId ?? p.route_id ?? ''),
      stopId: String(p.stopId ?? p.stop_id ?? stopId ?? ''),
      min,
      eta: String(p.eta ?? p.arrival_time ?? p.time ?? ''),
      vehicle: String(p.vehicle ?? p.vehicle_id ?? p.bus ?? ''),
      color: color || 'var(--green-fill)',
    };
  }).sort((a, b) => a.min - b.min);
}

export const getRoutes = fetchRoutes;
export const getStops = fetchStops;
export const getPredictions = fetchPredictions;
