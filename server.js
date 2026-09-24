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

function formatStopName(rawName) {
  if (!rawName) return 'Bus Stop';
  let name = String(rawName).trim();
  name = name.replace(/^0\d\s+/, '');
  name = name.replace(/^[1-9]\s+/, '');
  name = name.replace(/\s+/g, ' ');
  return name;
}

const distSq = (lat1, lon1, lat2, lon2) => {
  const dLat = (lat2 - lat1) * 111000;
  const dLon = (lon2 - lon1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
};

async function getPeakTransitUnifiedData() {
  const [routesRes, routeStopsRes, stopsRes, shapesRes, etaRes, vehRes] = await Promise.all([
    fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
    fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
    fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
    fetch(`${BPT_API_BASE}&controller=shape2&action=list`, { headers: SPOOFED_HEADERS }),
    fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
    fetch(`${BPT_API_BASE}&controller=vehicle&action=list`, { headers: SPOOFED_HEADERS }),
  ]);

  if (!routesRes.ok || !stopsRes.ok) {
    throw new Error('Peak Transit service unavailable');
  }

  const routesJson = await routesRes.json();
  const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
  const stopsJson = await stopsRes.json();
  const shapesJson = shapesRes.ok ? await shapesRes.json() : { shape: [] };
  const etaJson = etaRes.ok ? await etaRes.json() : { stop: [] };
  const vehJson = vehRes.ok ? await vehRes.json() : { vehicle: [] };

  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Cleaned stops map
  const stopMap = new Map();
  for (const s of (stopsJson.stop || [])) {
    const sId = String(s.stopID);
    stopMap.set(sId, {
      id: sId,
      name: formatStopName(s.longName || s.shortName),
      rawName: s.longName || s.shortName || 'Bus Stop',
      code: s.stopCode || '',
      lat: Number(s.lat),
      lng: Number(s.lng),
      lon: Number(s.lng),
      disabled: Boolean(s.disabled),
      hidden: Boolean(s.hidden),
    });
  }

  // 2. Active shapes by routeID
  const shapesByRoute = new Map();
  for (const sh of (shapesJson.shape || [])) {
    if (!sh.disabled && sh.points) {
      shapesByRoute.set(String(sh.routeID), sh);
    }
  }

  // 3. Route stops by routeID
  const routeStopsByRoute = new Map();
  for (const rs of (routeStopsJson.routeStops || [])) {
    if (!rs.disabled) {
      const rId = String(rs.routeID);
      if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
      routeStopsByRoute.get(rId).push(rs);
    }
  }

  // 4. Order stops along shape path for continuous loops
  const routeStopsMap = new Map();
  for (const [rId, rsList] of routeStopsByRoute.entries()) {
    const shape = shapesByRoute.get(rId);
    if (shape && shape.points && rsList.length > 0) {
      const points = shape.points.split(';').filter(Boolean).map((pt) => {
        const [lat, lng] = pt.split(',').map(Number);
        return { lat, lng };
      });

      const pos = rsList.map((rs) => {
        const s = stopMap.get(String(rs.stopID));
        if (!s) return { stopId: String(rs.stopID), idx: 999999 };
        let minD = Infinity;
        let bestIdx = 0;
        for (let i = 0; i < points.length; i++) {
          const d = (s.lat - points[i].lat) ** 2 + (s.lng - points[i].lng) ** 2;
          if (d < minD) {
            minD = d;
            bestIdx = i;
          }
        }
        return { stopId: String(rs.stopID), idx: bestIdx };
      });

      pos.sort((a, b) => a.idx - b.idx);
      routeStopsMap.set(rId, pos.map((p) => p.stopId));
    } else {
      rsList.sort((a, b) => Number(a.routeStopID ?? 0) - Number(b.routeStopID ?? 0));
      routeStopsMap.set(rId, rsList.map((rs) => String(rs.stopID)));
    }
  }

  // 5. Physical active vehicles in service
  const rawVehicles = Array.isArray(vehJson.vehicle) ? vehJson.vehicle : [];
  const activeVehicles = rawVehicles.filter((v) => v.oos === 0 && Number(v.routeID) > 0);
  const activeRouteIds = new Set(activeVehicles.map((v) => String(v.routeID)));

  const vehiclesByRoute = new Map();
  activeVehicles.forEach((v) => {
    const rId = String(v.routeID);
    if (!vehiclesByRoute.has(rId)) vehiclesByRoute.set(rId, []);
    vehiclesByRoute.get(rId).push(v);
  });

  // 6. Valid routes (filter out empty phantom routes like Hockey with 0 stops)
  const validRoutes = (routesJson.routes || [])
    .filter((r) => {
      const rId = String(r.routeID);
      const stops = routeStopsMap.get(rId) || [];
      if (r.disabled || stops.length === 0) return false;
      return !r.hidden || activeRouteIds.has(rId);
    })
    .map((r) => ({
      id: String(r.routeID),
      route_id: String(r.routeID),
      routeID: String(r.routeID),
      name: r.longName || r.shortName,
      route_name: r.longName || r.shortName,
      color: r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : '#00563b',
      stops: routeStopsMap.get(String(r.routeID)) || [],
    }));

  const validRouteIds = new Set(validRoutes.map((r) => r.id));

  // 7. Valid stops on valid routes
  const activeStopIds = new Set();
  const stopRoutesMap = new Map();
  for (const r of validRoutes) {
    for (const sId of r.stops) {
      activeStopIds.add(sId);
      if (!stopRoutesMap.has(sId)) stopRoutesMap.set(sId, []);
      if (!stopRoutesMap.get(sId).includes(r.id)) {
        stopRoutesMap.get(sId).push(r.id);
      }
    }
  }

  const validStops = Array.from(stopMap.values())
    .filter((s) => !s.disabled && activeStopIds.has(s.id))
    .map((s) => ({
      id: s.id,
      stop_id: s.id,
      stopID: s.id,
      name: s.name,
      code: s.code,
      lat: s.lat,
      lng: s.lng,
      lon: s.lng,
      routes: stopRoutesMap.get(s.id) || [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 8. Generate accurate real-time loop predictions for ALL active vehicles
  const predictions = [];
  const processedKeys = new Set();

  for (const [rId, vList] of vehiclesByRoute.entries()) {
    const loopStops = routeStopsMap.get(rId) || [];
    if (loopStops.length < 2) continue;

    for (const v of vList) {
      let vStopIdx = -1;
      if (v.nextStopID && loopStops.includes(String(v.nextStopID))) {
        vStopIdx = loopStops.indexOf(String(v.nextStopID));
      } else {
        let minD = Infinity;
        loopStops.forEach((sId, idx) => {
          const s = stopMap.get(sId);
          if (s) {
            const d = (v.lat - s.lat) ** 2 + (v.lng - s.lng) ** 2;
            if (d < minD) { minD = d; vStopIdx = idx; }
          }
        });
      }

      if (vStopIdx === -1) continue;

      const vStop = stopMap.get(loopStops[vStopIdx]);
      const distToNext = vStop ? Math.sqrt(distSq(v.lat, v.lng, vStop.lat, vStop.lng)) : 100;
      let firstLegMin = 0;
      if (distToNext <= 65) {
        firstLegMin = 0;
      } else if (distToNext <= 350) {
        firstLegMin = 1;
      } else {
        firstLegMin = Math.max(1, Math.round(distToNext / 300));
      }

      const vId = String(v.vehicleName || v.vehicleID);

      for (let offset = 0; offset < loopStops.length; offset++) {
        const targetIdx = (vStopIdx + offset) % loopStops.length;
        const targetStopId = loopStops[targetIdx];
        const key = `${rId}:${targetStopId}:${vId}`;
        if (processedKeys.has(key)) continue;

        let min = 0;
        if (offset === 0) {
          min = firstLegMin;
        } else {
          min = firstLegMin + Math.max(1, Math.round(offset * 1.6));
        }

        const arrTs = nowSec + min * 60;
        predictions.push({
          routeId: rId,
          stopId: targetStopId,
          min,
          eta: min === 0 ? 'Arriving now' : new Date(arrTs * 1000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }),
          vehicle: vId,
          timestamp: arrTs,
        });
        processedKeys.add(key);
      }
    }
  }

  // 9. Merge Peak Transit timetable ETAs if present and not already covered
  const stopsEta = Array.isArray(etaJson.stop) ? etaJson.stop : [];
  for (const item of stopsEta) {
    const rId = String(item.routeID);
    const sId = String(item.stopID);
    if (!validRouteIds.has(rId)) continue;

    for (const etaProp of ['ETA1', 'ETA2']) {
      const ts = item[etaProp];
      if (ts && ts > nowSec) {
        const min = Math.max(0, Math.round((ts - nowSec) / 60));
        const vehicle = String(item.vehicleID ?? item.busID ?? '');
        const key = `${rId}:${sId}:${vehicle || min}`;
        // If an active GPS prediction already exists around this time (+- 2 mins), don't duplicate
        const existsNearby = predictions.some((p) => p.routeId === rId && p.stopId === sId && Math.abs(p.min - min) <= 2);
        if (!existsNearby && !processedKeys.has(key)) {
          predictions.push({
            routeId: rId,
            stopId: sId,
            min,
            eta: min === 0 ? 'Arriving now' : new Date(ts * 1000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }),
            vehicle: vehicle,
            timestamp: ts,
          });
          processedKeys.add(key);
        }
      }
    }
  }

  predictions.sort((a, b) => a.min - b.min);

  return {
    validRoutes,
    validStops,
    predictions,
    routeStopsMap,
  };
}

async function fallbackPeakTransitLocal(endpoint, query) {
  try {
    const { validRoutes, validStops, predictions } = await getPeakTransitUnifiedData();

    if (endpoint === 'routes') {
      return { routes: validRoutes };
    }

    if (endpoint === 'stops') {
      const routeId = query?.route_id || query?.routeId;
      if (routeId) {
        return { stops: validStops.filter((s) => s.routes.includes(String(routeId))) };
      }
      return { stops: validStops };
    }

    if (endpoint === 'predictions' || endpoint === 'eta') {
      const stopId = query?.stop_id || query?.stopId;
      if (stopId) {
        return { predictions: predictions.filter((p) => String(p.stopId) === String(stopId)) };
      }
      return { predictions };
    }

    if (endpoint === 'feed' || endpoint === 'all') {
      const stopEtasMap = new Map();
      const routeEtasMap = new Map();

      for (const p of predictions) {
        if (!stopEtasMap.has(p.stopId)) stopEtasMap.set(p.stopId, []);
        stopEtasMap.get(p.stopId).push(p);

        if (!routeEtasMap.has(p.routeId)) routeEtasMap.set(p.routeId, new Map());
        if (!routeEtasMap.get(p.routeId).has(p.stopId)) routeEtasMap.get(p.routeId).set(p.stopId, []);
        routeEtasMap.get(p.routeId).get(p.stopId).push(p);
      }

      const routesWithEtas = validRoutes.map((r) => {
        const rEtasObj = {};
        if (routeEtasMap.has(r.id)) {
          for (const [sId, arr] of routeEtasMap.get(r.id).entries()) {
            rEtasObj[sId] = arr;
          }
        }
        return {
          ...r,
          etas: rEtasObj,
        };
      });

      const stopsWithEtas = validStops.map((s) => {
        const sEtas = (stopEtasMap.get(s.id) || []).map((e) => {
          const matchedRoute = validRoutes.find((r) => r.id === e.routeId);
          return {
            ...e,
            routeName: matchedRoute?.name || 'Shuttle',
            color: matchedRoute?.color || 'var(--green-fill)',
          };
        });
        return {
          ...s,
          etas: sEtas,
        };
      });

      return {
        ok: true,
        at: Date.now(),
        routes: routesWithEtas,
        stops: stopsWithEtas,
      };
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

    // Directly use Peak Transit v5 API exclusively
    const data = await fallbackPeakTransitLocal(subpath, req.query);
    if (data) {
      return res.json(data);
    }

    return res.status(502).json({ error: 'Peak Transit v5 service unavailable' });
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
