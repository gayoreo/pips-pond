// Campus bus (UVM CATS). Live data comes from UVM's Peak Transit API via Supabase Edge Function proxy.
import { SUPABASE_URL } from '../config.js';

const PROXY_BASE = `${SUPABASE_URL}/functions/v1/bus/`;

/**
 * Helper to call the Supabase Edge Function proxy.
 * Falls back to local proxy if remote Supabase function is unreachable.
 */
async function callProxy(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const queryString = query ? `?${query}` : '';
  const cleanPath = path.replace(/^\/+/, '');

  const urls = [
    `${PROXY_BASE}${cleanPath}${queryString}`,
    `/functions/v1/bus/${cleanPath}${queryString}`,
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
 * 1. Fetch active routes (/routes)
 * Returns an array of objects mapped to { id, name, color }.
 * Defaults the color to 'var(--green-fill)' if none is provided.
 */
export async function fetchRoutes() {
  const res = await callProxy('routes');
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
      name: String(r.name ?? r.route_name ?? r.routeName ?? r.title ?? r.short_name ?? 'Shuttle Route'),
      color: color || 'var(--green-fill)',
    };
  }).filter((r) => r.id && r.name);
}

/**
 * 2. Fetch stops for a selected route (/stops?route_id={id})
 * Passes route_id={id} to the proxy.
 * Returns an array of { id, name, code }.
 */
export async function fetchStops(routeId) {
  if (!routeId) return [];

  const res = await callProxy('stops', { route_id: String(routeId) });
  if (!res) return [];

  const raw = Array.isArray(res) ? res : (res.stops || res.data || []);
  if (!Array.isArray(raw)) return [];

  return raw.map((s) => ({
    id: String(s.id ?? s.stop_id ?? s.stopId ?? ''),
    name: String(s.name ?? s.stop_name ?? s.stopName ?? s.title ?? 'Bus Stop'),
    code: String(s.code ?? s.stop_code ?? s.stopCode ?? ''),
  })).filter((s) => s.id && s.name);
}

/**
 * 3. Fetch live arrival predictions for a selected stop (/predictions?stop_id={id})
 * Passes stop_id={id} to the proxy.
 * Returns an array of { routeName, min, eta, vehicle, color }, sorted from lowest min to highest.
 * Maps eta_minutes or minutes to min, ensuring it is a number and defaults to 0 if negative.
 */
export async function fetchPredictions(stopId) {
  if (!stopId) return [];

  const res = await callProxy('predictions', { stop_id: String(stopId) });
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
      } else if (p.arrival_time) {
        const diff = new Date(p.arrival_time).getTime() - Date.now();
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
      min,
      eta: String(p.eta ?? p.arrival_time ?? p.time ?? ''),
      vehicle: String(p.vehicle ?? p.vehicle_id ?? p.bus ?? ''),
      color: color || 'var(--green-fill)',
    };
  }).sort((a, b) => a.min - b.min);
}

// Aliases
export const getRoutes = fetchRoutes;
export const getStops = fetchStops;
export const getPredictions = fetchPredictions;
