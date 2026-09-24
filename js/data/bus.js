// Campus bus (UVM CATS). Live data comes from Peak Transit API via Supabase Edge Function proxy.
import { SUPABASE_URL } from '../config.js';
import { getProfile, saveProfile } from './db.js';

export const DEFAULT_WALK = 5;
export const BACKUP_WINDOW = 20;

// In-memory cache constants
const STATIC_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const PREDICTIONS_CACHE_TTL = 20 * 1000; // 20 seconds

const _cache = {
  routes: new Map(),
  stops: new Map(),
  predictions: new Map(),
};

const PROXY_BASE = `${SUPABASE_URL}/functions/v1/bus`;

/**
 * Helper to call the Supabase Edge Function proxy.
 * Tries local relative proxy if remote host is offline or not configured.
 */
async function callProxy(path = '', params = {}) {
  let cleanPath = path ? path.replace(/^\/+/, '') : '';
  const searchParams = new URLSearchParams(params);
  if (cleanPath.includes('?')) {
    const [p, q] = cleanPath.split('?');
    cleanPath = p;
    new URLSearchParams(q).forEach((v, k) => searchParams.set(k, v));
  }
  const query = searchParams.toString();
  const queryString = query ? `?${query}` : '';

  const baseOrigin = typeof location !== 'undefined' && location.origin ? location.origin : 'http://localhost:3000';
  const urls = [
    `${baseOrigin}/functions/v1/bus${cleanPath ? `/${cleanPath}` : ''}${queryString}`,
    `${PROXY_BASE}${cleanPath ? `/${cleanPath}` : ''}${queryString}`,
    `${baseOrigin}/api/bus?endpoint=/${cleanPath}${query ? `&${query}` : ''}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Continue to next fallback
    }
  }

  return null;
}

/**
 * Normalizes building or place names into uniform dictionary keys
 * (e.g. "Davis Center" -> "daviscenter")
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
 * Campus walking speed: ~80 meters per minute.
 */
export function walkMinutes(distance) {
  if (!distance || distance <= 0) return 0;
  const meters = distance < 30 ? distance * 1000 : distance;
  return Math.max(1, Math.round(meters / 80));
}

/**
 * Great-circle distance between two GPS coordinates
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
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
 * Finds nearest bus stops to a given coordinate using Haversine formula
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
 * Fetches all routes, stops, and live ETAs.
 * Exclusively uses Peak Transit v5 via proxy.
 */
export async function loadBus() {
  try {
    // 1. Fetch active routes with stops
    const routes = await fetchRoutes();

    // 2. Fetch stops and live arrival predictions
    const [stops, preds] = await Promise.all([
      fetchStops(),
      fetchPredictions(),
    ]);

    const stopsMap = new Map();
    for (const s of stops) {
      stopsMap.set(String(s.id), { ...s, etas: [] });
    }

    const routesMap = new Map();
    for (const r of routes) {
      routesMap.set(String(r.id), { ...r, stops: Array.isArray(r.stops) ? r.stops.map(String) : [], etas: {} });
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
 * A-to-B Trip Planning:
 * Determines which buses travel from origin stop to destination stop in that specific direction.
 * UVM buses run specific loops, so we check the loop sequence of stops.
 *
 * @param {{ stops: Array, routes: Array }} feed
 * @param {{ from: string|number|Array, to: string|number|Array }} options
 * @returns {Array} List of possible trips calculated with leaveIn, busIn, arriveIn, boardStop, alightStop
 */
export function planTrip(feed, { from, to } = {}) {
  if (!feed || !Array.isArray(feed.routes) || !Array.isArray(feed.stops)) {
    return [];
  }

  // Normalize inputs (handles arrays of stopIds or stop objects, or single strings)
  const fromList = (Array.isArray(from) ? from : [from])
    .filter(Boolean)
    .map((item) => {
      if (typeof item === 'object' && item !== null) {
        return {
          stopId: String(item.stopId ?? item.id ?? item.stopID ?? ''),
          walk: Number(item.walk ?? item.walkMinutes ?? DEFAULT_WALK),
        };
      }
      return { stopId: String(item), walk: DEFAULT_WALK };
    })
    .filter((x) => x.stopId);

  const toList = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((item) => {
      if (typeof item === 'object' && item !== null) {
        return String(item.stopId ?? item.id ?? item.stopID ?? '');
      }
      return String(item);
    })
    .filter(Boolean);

  if (fromList.length === 0 || toList.length === 0) {
    return [];
  }

  const stopsMap = new Map();
  for (const s of feed.stops) {
    stopsMap.set(String(s.id ?? s.stopId ?? s.stopID), s);
  }

  const trips = [];
  const now = Date.now();

  for (const fromCandidate of fromList) {
    const originStopId = fromCandidate.stopId;
    const walk = fromCandidate.walk;
    const boardStop = stopsMap.get(originStopId);
    if (!boardStop) continue;

    for (const destStopId of toList) {
      if (originStopId === destStopId) continue;
      const alightStop = stopsMap.get(destStopId);
      if (!alightStop) continue;

      for (const route of feed.routes) {
        const routeStops = (route.stops || []).map(String);
        if (routeStops.length < 2) continue;

        const startIdx = routeStops.indexOf(originStopId);
        const endIdx = routeStops.indexOf(destStopId);

        // Explicitly verify directionality along route.stops:
        // A route is only a valid connection if endStop exists in the array after startStop
        // or wraps around, since these are continuous loops.
        if (startIdx === -1 || endIdx === -1 || startIdx === endIdx) continue;

        let stopsCount = 0;
        if (endIdx > startIdx) {
          stopsCount = endIdx - startIdx;
        } else if (endIdx < startIdx) {
          // Loop wrap-around
          stopsCount = (routeStops.length - startIdx) + endIdx;
        }

        if (stopsCount <= 0 || stopsCount >= routeStops.length) continue;

        // Estimated transit ride time: ~1.6 mins per stop, minimum 2 mins
        const rideMinutes = Math.max(2, Math.round(stopsCount * 1.6));

        // Get live arrival predictions for this route at the boarding stop
        let etas = [];
        if (route.etas && route.etas[originStopId]) {
          etas = route.etas[originStopId];
        } else if (Array.isArray(boardStop.etas)) {
          etas = boardStop.etas.filter((e) => String(e.routeId) === String(route.id));
        }

        // If no direct ETA exists at this stop, check if any stop on this route has an active ETA
        // and propagate arrival along the loop forward to boardStop
        if (etas.length === 0) {
          let activeEta = null;
          let minDistanceToBus = Infinity;

          if (route.etas) {
            for (const [sId, sEtas] of Object.entries(route.etas)) {
              if (Array.isArray(sEtas) && sEtas.length > 0) {
                const busStopIdx = routeStops.indexOf(String(sId));
                if (busStopIdx !== -1) {
                  // Distance from bus to boarding stop along loop
                  const distToBoard = startIdx >= busStopIdx ? (startIdx - busStopIdx) : (routeStops.length - busStopIdx + startIdx);
                  if (distToBoard < minDistanceToBus) {
                    minDistanceToBus = distToBoard;
                    activeEta = { ...sEtas[0], distToBoard };
                  }
                }
              }
            }
          }

          if (activeEta) {
            const propagatedMin = Math.round(Number(activeEta.min ?? 0) + minDistanceToBus * 1.6);
            const ts = activeEta.timestamp ? (activeEta.timestamp + minDistanceToBus * 96) : (Math.floor(now / 1000) + propagatedMin * 60);
            etas = [{
              ...activeEta,
              min: propagatedMin,
              eta: propagatedMin === 0 ? 'Arriving now' : new Date(ts * 1000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }),
              isPropagated: true,
            }];
          } else {
            // No active shuttle on this route right now - do not fabricate a fake 6 minute estimate
            etas = [{
              min: 9999,
              eta: 'No active bus right now',
              noActiveBus: true,
            }];
          }
        }

        for (const etaItem of etas) {
          const isNoActive = Boolean(etaItem.noActiveBus);
          const busIn = isNoActive ? null : Math.max(0, Math.round(Number(etaItem.min ?? 0)));
          const leaveIn = isNoActive ? null : (busIn - walk);
          const arriveIn = isNoActive ? null : (busIn + rideMinutes);
          const arriveTime = isNoActive
            ? `~${rideMinutes} min ride`
            : new Date(now + arriveIn * 60000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

          trips.push({
            route: {
              id: route.id,
              name: route.name,
              color: route.color || 'var(--green-fill)',
              stops: routeStops,
            },
            routeName: route.name,
            routeColor: route.color || 'var(--green-fill)',
            vehicle: String(etaItem.vehicle || ''),
            eta: String(etaItem.eta || (busIn !== null ? `${busIn}m` : 'No active bus')),
            arriveEta: arriveTime,
            min: isNoActive ? 9999 : busIn,
            busIn,
            leaveIn,
            arriveIn,
            rideMinutes,
            walk,
            stopsCount,
            boardStop,
            alightStop,
            noActiveBus: isNoActive,
            isArrivingNow: busIn === 0,
          });
        }
      }
    }
  }

  // Enforce ascending sort order (a.min - b.min) so the soonest arriving shuttle is always best
  return trips.sort((a, b) => a.min - b.min);
}

/**
 * Returns the best trip and a secondary backup option within BACKUP_WINDOW minutes
 */
export function pickTwo(trips = []) {
  if (!Array.isArray(trips) || trips.length === 0) {
    return { best: null, backup: null };
  }

  // Enforce ascending sort order (a.min - b.min) so the soonest arriving shuttle is always best
  const sorted = [...trips].sort((a, b) => a.min - b.min);

  const best = sorted[0] || null;
  if (!best) return { best: null, backup: null };

  let backup = null;
  for (let i = 1; i < sorted.length; i++) {
    const candidate = sorted[i];
    const diff = candidate.min - best.min;
    if (diff >= 0 && diff <= BACKUP_WINDOW) {
      backup = candidate;
      break;
    }
  }

  if (!backup && sorted.length > 1) {
    const second = sorted[1];
    if (second.min - best.min <= BACKUP_WINDOW + 10) {
      backup = second;
    }
  }

  return { best, backup };
}

// -------------------------------------------------------------
// Direct endpoints
// -------------------------------------------------------------

export async function fetchRoutes(params = {}) {
  const cacheKey = JSON.stringify(params || {});
  const cached = _cache.routes.get(cacheKey);
  if (cached && (Date.now() - cached.time < STATIC_CACHE_TTL)) {
    return cached.data;
  }

  const res = await callProxy('routes', params);
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.routes || res.data || []);
  if (!Array.isArray(raw)) return [];

  const result = raw.map((r) => {
    let color = r.color || r.route_color || r.routeColor || '';
    if (color && !color.startsWith('#') && !color.startsWith('var(')) {
      color = `#${color}`;
    }
    return {
      id: String(r.id ?? r.route_id ?? r.routeID ?? ''),
      name: String(r.name ?? r.route_name ?? r.routeName ?? r.title ?? r.short_name ?? 'Shuttle Route'),
      color: color || 'var(--green-fill)',
      stops: Array.isArray(r.stops) ? r.stops.map(String) : [],
    };
  }).filter((r) => r.id && r.name);

  _cache.routes.set(cacheKey, { data: result, time: Date.now() });
  return result;
}

export async function fetchStops(routeId = null, params = {}) {
  const cacheKey = `${routeId ?? 'all'}:${JSON.stringify(params || {})}`;
  const cached = _cache.stops.get(cacheKey);
  if (cached && (Date.now() - cached.time < STATIC_CACHE_TTL)) {
    return cached.data;
  }

  const query = routeId ? { route_id: String(routeId), ...params } : params;
  const res = await callProxy('stops', query);
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.stops || res.data || []);
  if (!Array.isArray(raw)) return [];

  const result = raw.map((s) => ({
    id: String(s.id ?? s.stop_id ?? s.stopID ?? ''),
    name: String(s.name ?? s.stop_name ?? s.stopName ?? s.title ?? 'Bus Stop'),
    code: String(s.code ?? s.stop_code ?? s.stopCode ?? ''),
    lat: s.lat,
    lng: s.lng,
    lon: s.lng,
  })).filter((s) => s.id && s.name);

  _cache.stops.set(cacheKey, { data: result, time: Date.now() });
  return result;
}

export async function fetchPredictions(stopId = null, params = {}) {
  const cacheKey = `${stopId ?? 'all'}:${JSON.stringify(params || {})}`;
  const cached = _cache.predictions.get(cacheKey);
  if (cached && (Date.now() - cached.time < PREDICTIONS_CACHE_TTL)) {
    return cached.data;
  }

  const query = stopId ? { stop_id: String(stopId), ...params } : params;
  const res = await callProxy('predictions', query);
  if (!res) return [];
  const raw = Array.isArray(res) ? res : (res.predictions || res.arrivals || res.data || []);
  if (!Array.isArray(raw)) return [];

  const cachedRoutes = _cache.routes.get('{}')?.data || [];
  const routeMap = new Map(cachedRoutes.map((r) => [String(r.id), r]));

  const result = raw.map((p) => {
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

    const rId = String(p.routeId ?? p.route_id ?? '');
    const matched = routeMap.get(rId);

    let color = p.color || p.route_color || p.routeColor || matched?.color || '';
    if (color && !color.startsWith('#') && !color.startsWith('var(')) {
      color = `#${color}`;
    }

    return {
      routeName: String(p.routeName ?? p.route_name ?? p.route ?? matched?.name ?? 'Shuttle'),
      routeId: rId,
      stopId: String(p.stopId ?? p.stop_id ?? stopId ?? ''),
      min,
      eta: String(p.eta ?? p.arrival_time ?? p.time ?? ''),
      vehicle: String(p.vehicle ?? p.vehicle_id ?? p.bus ?? ''),
      color: color || 'var(--green-fill)',
    };
  }).sort((a, b) => a.min - b.min);

  _cache.predictions.set(cacheKey, { data: result, time: Date.now() });
  return result;
}

export const getRoutes = fetchRoutes;
export const getStops = fetchStops;
export const getPredictions = fetchPredictions;

/**
 * Helpers for watching a specific bus trip from Pip's Pond
 * Stored under profile.busWatch
 */
export async function getWatchedTrip() {
  const profile = await getProfile();
  return profile?.busWatch || null;
}

export async function saveWatchedTrip(tripData) {
  if (!tripData) {
    await saveProfile({ busWatch: null });
    return null;
  }
  const watched = {
    routeId: String(tripData.routeId ?? ''),
    routeName: String(tripData.routeName ?? ''),
    fromStopId: String(tripData.fromStopId ?? ''),
    fromStopName: String(tripData.fromStopName ?? ''),
    toStopId: String(tripData.toStopId ?? ''),
    toStopName: String(tripData.toStopName ?? ''),
    color: tripData.color || 'var(--green-fill)',
  };
  await saveProfile({ busWatch: watched });
  return watched;
}
