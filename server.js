import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const SPOOFED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://uvm.rider.peaktransit.com',
  'Referer': 'https://uvm.rider.peaktransit.com/',
  'Accept-Language': 'en-US,en;q=0.9',
};
const BPT_API_BASE = 'https://api.peaktransit.com/v5/index.php?app_id=_RIDER&key=c620b8fe5fdbd6107da8c8381f4345b4&agencyID=159';

async function fallbackPeakTransitLocal(endpoint, query) {
  try {
    if (endpoint === 'routes') {
      const res = await fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS });
      if (res.ok) {
        const json = await res.json();
        const routes = (json.routes || [])
          .map((r) => ({
            id: r.routeID,
            route_id: r.routeID,
            routeID: r.routeID,
            name: r.longName || r.shortName,
            route_name: r.longName || r.shortName,
            color: r.color ? `#${r.color}` : '#00563b',
            hidden: r.hidden,
            disabled: r.disabled,
          }))
          .filter((r) => !r.hidden && !r.disabled);
        return { routes };
      }
    } else if (endpoint === 'stops') {
      const routeId = query.route_id || query.routeId;
      const [stopsRes, routeStopsRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (stopsRes.ok && routeStopsRes.ok) {
        const stopsJson = await stopsRes.json();
        const routeStopsJson = await routeStopsRes.json();
        const allStops = stopsJson.stop || [];
        const routeStops = routeStopsJson.routeStops || [];
        const validStopIds = new Set();
        if (routeId) {
          routeStops
            .filter((rs) => String(rs.routeID) === String(routeId) && !rs.disabled)
            .forEach((rs) => validStopIds.add(rs.stopID));
        }
        const filteredStops = allStops
          .filter((s) => (!routeId || validStopIds.has(s.stopID)) && !s.disabled && !s.hidden)
          .map((s) => ({
            id: s.stopID,
            stop_id: s.stopID,
            stopID: s.stopID,
            name: s.longName || s.shortName || 'Bus Stop',
            stop_name: s.longName || s.shortName || 'Bus Stop',
            code: s.stopCode || '',
            lat: s.lat,
            lng: s.lng,
          }));
        return { stops: filteredStops };
      }
    } else if (endpoint === 'predictions' || endpoint === 'eta') {
      const stopId = query.stop_id || query.stopId;
      const [etaRes, routesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (etaRes.ok) {
        const etaJson = await etaRes.json();
        const routesJson = routesRes.ok ? await routesRes.json() : { routes: [] };
        const routeMap = new Map();
        (routesJson.routes || []).forEach((r) => {
          routeMap.set(String(r.routeID), {
            name: r.longName || r.shortName,
            color: r.color ? `#${r.color}` : '#00563b',
          });
        });
        const stopsEta = etaJson.stop || [];
        const predictions = [];
        const nowSec = Math.floor(Date.now() / 1000);
        for (const item of stopsEta) {
          if (!stopId || String(item.stopID) === String(stopId)) {
            const routeInfo = routeMap.get(String(item.routeID)) || { name: 'Shuttle', color: 'var(--green-fill)' };
            if (item.ETA1 && item.ETA1 > nowSec) {
              const min = Math.max(0, Math.round((item.ETA1 - nowSec) / 60));
              predictions.push({
                routeName: routeInfo.name,
                min,
                eta: new Date(item.ETA1 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                vehicle: String(item.vehicleID || item.busID || ''),
                color: routeInfo.color,
              });
            }
            if (item.ETA2 && item.ETA2 > nowSec) {
              const min = Math.max(0, Math.round((item.ETA2 - nowSec) / 60));
              predictions.push({
                routeName: routeInfo.name,
                min,
                eta: new Date(item.ETA2 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                vehicle: String(item.vehicleID || item.busID || ''),
                color: routeInfo.color,
              });
            }
          }
        }
        predictions.sort((a, b) => a.min - b.min);
        return { predictions };
      }
    }
  } catch (e) {
    console.error('[Server Bus Fallback Error]', e);
  }
  return null;
}

// Proxy endpoint for Peak Transit API to bypass CORS
app.all(['/api/bus', '/functions/v1/bus', '/functions/v1/bus/*'], async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }

  try {
    let subpath = '';
    const match = req.path.match(/\/bus(?:\/(.*))?$/);
    if (match && match[1]) {
      subpath = match[1];
    } else if (req.query.endpoint || req.query.path) {
      subpath = req.query.endpoint || req.query.path;
    }
    subpath = (subpath || 'routes').replace(/^\/+/, '');

    const targetUrl = new URL(`https://uvm.rider.peaktransit.com/api/v1/${subpath}`);
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'endpoint' && k !== 'path') {
        targetUrl.searchParams.set(k, v);
      }
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: SPOOFED_HEADERS,
    });

    if (upstream.ok) {
      const data = await upstream.json();
      return res.json(data);
    }

    if (upstream.status === 404 || upstream.status === 502) {
      const fallback = await fallbackPeakTransitLocal(subpath, req.query);
      if (fallback) {
        return res.json(fallback);
      }
    }

    return res.status(upstream.status).json({ error: `Peak Transit status: ${upstream.statusText}` });
  } catch (err) {
    console.error('Local bus proxy error:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// Serve static assets
app.use(express.static(__dirname));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pip's Pond running on http://0.0.0.0:${PORT}`);
});
