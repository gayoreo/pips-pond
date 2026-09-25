import { SUPABASE_URL } from '../config.js';
import { getProfile, saveProfile } from './db.js';

export const DEFAULT_WALK = 5;
export const BACKUP_WINDOW = 20;

const PROXY_BASE = `${SUPABASE_URL}/functions/v1/bus`;

let _cachedFeed = null;
let _cacheTime = 0;
const CACHE_TTL = 15 * 1000; // Cache feed for 15 seconds

async function fetchFromProxy(endpoint) {
  const baseOrigin = typeof location !== 'undefined' && location.origin ? location.origin : 'http://localhost:3000';
  const urls = [
    `${baseOrigin}/functions/v1/bus/${endpoint}`,
    `${PROXY_BASE}/${endpoint}`,
    `${baseOrigin}/api/bus?endpoint=${endpoint}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* fallback */ }
  }
  return null;
}

export async function loadBus() {
  if (_cachedFeed && Date.now() - _cacheTime < CACHE_TTL) {
    return _cachedFeed;
  }
  try {
    const feed = await fetchFromProxy('feed');
    if (feed && feed.ok) {
      _cachedFeed = feed;
      _cacheTime = Date.now();
      return feed;
    }
    return { ok: false, error: 'Empty transit feed' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Helpers for view compatibility
export const fetchRoutes = async () => (await loadBus()).routes || [];
export const fetchStops = async () => (await loadBus()).stops || [];

export function planTrip(feed, { from, to }) {
  if (!feed?.routes || !feed?.stops) return [];

  const fromId = String(from);
  const toId = String(to);
  if (!fromId || !toId || fromId === toId) return [];

  const boardStop = feed.stops.find(s => String(s.id) === fromId);
  const alightStop = feed.stops.find(s => String(s.id) === toId);
  if (!boardStop || !alightStop) return [];

  const trips = [];
  const now = Date.now();

  for (const route of feed.routes) {
    const stops = (route.stops || []).map(String);
    if (stops.length < 2) continue;

    const startIdx = stops.indexOf(fromId);
    const endIdx = stops.indexOf(toId);

    if (startIdx === -1 || endIdx === -1 || startIdx === endIdx) continue;

    let stopsCount = 0;
    if (endIdx > startIdx) {
      stopsCount = endIdx - startIdx;
    } else {
      stopsCount = (stops.length - startIdx) + endIdx; // Continuous loop wrap-around
    }

    const rideMinutes = Math.max(2, Math.round(stopsCount * 1.6));

    // The backend now maps real ETAs directly to the stops on the route
    const etas = route.etas?.[fromId] || [];

    if (etas.length === 0) {
      trips.push({
        route,
        routeName: route.name,
        routeColor: route.color || 'var(--green-fill)',
        vehicle: '',
        eta: 'No active bus right now',
        arriveEta: `~${rideMinutes} min ride`,
        min: 9999,
        busIn: null,
        leaveIn: null,
        arriveIn: null,
        rideMinutes,
        stopsCount,
        boardStop,
        alightStop,
        noActiveBus: true,
        isArrivingNow: false
      });
      continue;
    }

    for (const etaItem of etas) {
      const busIn = Math.max(0, Math.round(etaItem.min));
      const arriveIn = busIn + rideMinutes;
      const arriveTime = new Date(now + arriveIn * 60000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

      trips.push({
        route,
        routeName: route.name,
        routeColor: route.color || 'var(--green-fill)',
        vehicle: String(etaItem.vehicle || ''),
        eta: etaItem.eta || `${busIn}m`,
        arriveEta: arriveTime,
        min: busIn,
        busIn,
        leaveIn: busIn - DEFAULT_WALK,
        arriveIn,
        rideMinutes,
        stopsCount,
        boardStop,
        alightStop,
        noActiveBus: false,
        isArrivingNow: busIn === 0
      });
    }
  }

  // Ascending sort (lowest ETA first)
  return trips.sort((a, b) => a.min - b.min);
}

export function pickTwo(trips = []) {
  if (!trips.length) return { best: null, backup: null };
  const sorted = [...trips].sort((a, b) => a.min - b.min);
  const best = sorted[0];
  let backup = null;
  for (let i = 1; i < sorted.length; i++) {
    if (!sorted[i].noActiveBus) {
      backup = sorted[i];
      break;
    }
  }
  return { best, backup };
}

export async function getWatchedTrip() {
  return (await getProfile())?.busWatch || null;
}

export async function saveWatchedTrip(tripData) {
  const watched = tripData ? {
    routeId: String(tripData.routeId || ''),
    routeName: String(tripData.routeName || ''),
    fromStopId: String(tripData.fromStopId || ''),
    fromStopName: String(tripData.fromStopName || ''),
    toStopId: String(tripData.toStopId || ''),
    toStopName: String(tripData.toStopName || ''),
    color: tripData.color || 'var(--green-fill)'
  } : null;
  await saveProfile({ busWatch: watched });
  return watched;
}