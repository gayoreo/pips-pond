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
      const [routesRes, routeStopsRes, stopsRes, shapesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=shape2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (routesRes.ok) {
        const json = await routesRes.json();
        const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
        const stopsJson = stopsRes.ok ? await stopsRes.json() : { stop: [] };
        const shapesJson = shapesRes.ok ? await shapesRes.json() : { shape: [] };

        const stopMap = new Map();
        for (const s of (stopsJson.stop || [])) {
          stopMap.set(String(s.stopID), s);
        }

        const shapesByRoute = new Map();
        for (const sh of (shapesJson.shape || [])) {
          if (!sh.disabled && sh.points) {
            shapesByRoute.set(String(sh.routeID), sh);
          }
        }

        const routeStopsByRoute = new Map();
        for (const rs of (routeStopsJson.routeStops || [])) {
          if (!rs.disabled) {
            const rId = String(rs.routeID);
            if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
            routeStopsByRoute.get(rId).push(rs);
          }
        }

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
            rsList.sort((a, b) => {
              const orderA = Number(a.sortOrder ?? a.sequence ?? a.routeStopID ?? 0);
              const orderB = Number(b.sortOrder ?? b.sequence ?? b.routeStopID ?? 0);
              return orderA - orderB;
            });
            routeStopsMap.set(rId, rsList.map((rs) => String(rs.stopID)));
          }
        }

        const routes = (json.routes || [])
          .filter((r) => !r.hidden && !r.disabled)
          .map((r) => ({
            id: String(r.routeID),
            name: r.longName || r.shortName,
            color: r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : '#00563b',
            stops: routeStopsMap.get(String(r.routeID)) || [],
          }));
        return { routes };
      }
    } else if (endpoint === 'stops') {
      const [stopsRes, routeStopsRes, routesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (stopsRes.ok) {
        const stopsJson = await stopsRes.json();
        const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
        const routesJson = routesRes.ok ? await routesRes.json() : { routes: [] };

        const activeRouteIds = new Set();
        (routesJson.routes || []).forEach((r) => {
          if (!r.hidden && !r.disabled) activeRouteIds.add(String(r.routeID));
        });

        const activeStopIds = new Set();
        const stopRoutesMap = new Map();
        (routeStopsJson.routeStops || []).forEach((rs) => {
          const rId = String(rs.routeID);
          if (!rs.disabled && (activeRouteIds.size === 0 || activeRouteIds.has(rId))) {
            const sId = String(rs.stopID);
            activeStopIds.add(sId);
            if (!stopRoutesMap.has(sId)) stopRoutesMap.set(sId, []);
            if (!stopRoutesMap.get(sId).includes(rId)) {
              stopRoutesMap.get(sId).push(rId);
            }
          }
        });

        const allStops = stopsJson.stop || [];
        const filteredStops = allStops
          .filter((s) => !s.disabled && !s.hidden && (activeStopIds.size === 0 || activeStopIds.has(String(s.stopID))))
          .map((s) => ({
            id: String(s.stopID),
            name: s.longName || s.shortName || 'Bus Stop',
            code: s.stopCode || '',
            lat: s.lat,
            lng: s.lng,
            routes: stopRoutesMap.get(String(s.stopID)) || [],
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return { stops: filteredStops };
      }
    } else if (endpoint === 'predictions' || endpoint === 'eta') {
      const stopId = query.stop_id || query.stopId;
      const [etaRes, vehRes, stopsRes, routeStopsRes, shapesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=vehicle&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=shape2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (etaRes.ok || vehRes.ok) {
        const etaJson = etaRes.ok ? await etaRes.json() : { stop: [] };
        const vehJson = vehRes.ok ? await vehRes.json() : { vehicle: [] };
        const stopsJson = stopsRes.ok ? await stopsRes.json() : { stop: [] };
        const rsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
        const shapesJson = shapesRes.ok ? await shapesRes.json() : { shape: [] };

        const nowSec = Math.floor(Date.now() / 1000);
        const stopMap = new Map();
        (stopsJson.stop || []).forEach((s) => stopMap.set(String(s.stopID), s));

        const distSq = (lat1, lon1, lat2, lon2) => {
          const dLat = (lat2 - lat1) * 111000;
          const dLon = (lon2 - lon1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
          return dLat * dLat + dLon * dLon;
        };

        const rawVehicles = Array.isArray(vehJson.vehicle) ? vehJson.vehicle : [];
        const activeVehicles = rawVehicles.filter((v) => v.oos === 0 && Number(v.routeID) > 0);

        const vehiclesByRoute = new Map();
        activeVehicles.forEach((v) => {
          const rId = String(v.routeID);
          if (!vehiclesByRoute.has(rId)) vehiclesByRoute.set(rId, []);
          vehiclesByRoute.get(rId).push(v);
        });

        const predictions = [];
        const processedKeys = new Set();

        const stopsEta = Array.isArray(etaJson.stop) ? etaJson.stop : [];
        for (const item of stopsEta) {
          const rId = String(item.routeID);
          const sId = String(item.stopID);

          const routeVehicles = vehiclesByRoute.get(rId);
          if (activeVehicles.length > 0 && (!routeVehicles || routeVehicles.length === 0)) {
            continue; // Ghost bus discarded
          }

          const stop = stopMap.get(sId);
          let closestVeh = routeVehicles && routeVehicles.length > 0 ? routeVehicles[0] : null;
          let closestDist = Infinity;
          if (stop && routeVehicles) {
            for (const v of routeVehicles) {
              const d = Math.sqrt(distSq(v.lat, v.lng, stop.lat, stop.lng));
              if (d < closestDist) {
                closestDist = d;
                closestVeh = v;
              }
            }
          }

          if (!stopId || String(sId) === String(stopId)) {
            for (const etaProp of ['ETA1', 'ETA2']) {
              const ts = item[etaProp];
              if (ts && ts > nowSec) {
                let min = Math.max(0, Math.round((ts - nowSec) / 60));
                if (etaProp === 'ETA1' && closestDist <= 65) {
                  min = 0;
                }
                const vehName = closestVeh ? String(closestVeh.vehicleName || closestVeh.vehicleID) : String(item.vehicleID ?? item.busID ?? '');
                predictions.push({
                  routeId: rId,
                  stopId: sId,
                  min,
                  eta: min === 0 ? 'Arriving now' : new Date(ts * 1000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }),
                  vehicle: vehName,
                });
                processedKeys.add(`${rId}:${sId}`);
              }
            }
          }
        }

        // Loop-propagated GPS arrivals for active vehicles
        if (activeVehicles.length > 0) {
          const shapesByRoute = new Map();
          for (const sh of (shapesJson.shape || [])) {
            if (!sh.disabled && sh.points) shapesByRoute.set(String(sh.routeID), sh);
          }

          const routeStopsByRoute = new Map();
          for (const rs of (rsJson.routeStops || [])) {
            if (!rs.disabled) {
              const rId = String(rs.routeID);
              if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
              routeStopsByRoute.get(rId).push(rs);
            }
          }

          for (const [rId, vList] of vehiclesByRoute.entries()) {
            const rsList = routeStopsByRoute.get(rId) || [];
            if (rsList.length < 2) continue;

            const shape = shapesByRoute.get(rId);
            let loopStops = [];
            if (shape && shape.points) {
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
                  if (d < minD) { minD = d; bestIdx = i; }
                }
                return { stopId: String(rs.stopID), idx: bestIdx };
              });
              pos.sort((a, b) => a.idx - b.idx);
              loopStops = pos.map((p) => p.stopId);
            } else {
              loopStops = rsList.map((rs) => String(rs.stopID));
            }

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

              for (let offset = 0; offset < loopStops.length; offset++) {
                const targetIdx = (vStopIdx + offset) % loopStops.length;
                const targetStopId = loopStops[targetIdx];
                if (stopId && String(targetStopId) !== String(stopId)) continue;

                const key = `${rId}:${targetStopId}`;
                if (processedKeys.has(key)) continue;

                const targetStop = stopMap.get(targetStopId);
                const distToTarget = targetStop ? Math.sqrt(distSq(v.lat, v.lng, targetStop.lat, targetStop.lng)) : Infinity;

                let min = 0;
                if (offset === 0 && distToTarget <= 65) {
                  min = 0;
                } else {
                  min = Math.max(1, Math.round(offset * 1.6));
                }

                const arrTs = nowSec + min * 60;
                predictions.push({
                  routeId: rId,
                  stopId: targetStopId,
                  min,
                  eta: min === 0 ? 'Arriving now' : new Date(arrTs * 1000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }),
                  vehicle: String(v.vehicleName || v.vehicleID),
                });
                processedKeys.add(key);
              }
            }
          }
        }

        predictions.sort((a, b) => a.min - b.min);
        return { predictions };
      }
    } else if (endpoint === 'feed') {
      const [routesRes, stopsRes, routeStopsRes, etaRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (routesRes.ok && stopsRes.ok && routeStopsRes.ok && etaRes.ok) {
        const routesJson = await routesRes.json();
        const stopsJson = await stopsRes.json();
        const routeStopsJson = await routeStopsRes.json();
        const etaJson = await etaRes.json();
        const nowSec = Math.floor(Date.now() / 1000);

        const routeStopsByRoute = new Map();
        for (const rs of (routeStopsJson.routeStops || [])) {
          if (!rs.disabled) {
            const rId = String(rs.routeID);
            if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
            routeStopsByRoute.get(rId).push(rs);
          }
        }

        const routeStopsMap = new Map();
        for (const [rId, rsList] of routeStopsByRoute.entries()) {
          rsList.sort((a, b) => {
            const orderA = Number(a.sortOrder ?? a.sequence ?? a.routeStopID ?? 0);
            const orderB = Number(b.sortOrder ?? b.sequence ?? b.routeStopID ?? 0);
            return orderA - orderB;
          });
          routeStopsMap.set(rId, rsList.map((rs) => String(rs.stopID)));
        }

        const stopEtasMap = new Map();
        const routeEtasMap = new Map();
        for (const item of (etaJson.stop || [])) {
          const vehicle = item.vehicleID ?? item.busID;
          if (vehicle === null || vehicle === undefined || String(vehicle).trim() === '') {
            continue;
          }
          const sId = Number(item.stopID);
          const rId = String(item.routeID);
          if (!stopEtasMap.has(sId)) stopEtasMap.set(sId, []);
          if (!routeEtasMap.has(rId)) routeEtasMap.set(rId, new Map());
          if (!routeEtasMap.get(rId).has(sId)) routeEtasMap.get(rId).set(sId, []);

          for (const etaProp of ['ETA1', 'ETA2']) {
            const ts = item[etaProp];
            if (ts && ts > nowSec) {
              const min = Math.max(0, Math.round((ts - nowSec) / 60));
              const entry = {
                routeId: rId,
                stopId: sId,
                min,
                eta: new Date(ts * 1000).toLocaleTimeString([], { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }),
                vehicle: String(vehicle),
                timestamp: ts,
              };
              stopEtasMap.get(sId).push(entry);
              routeEtasMap.get(rId).get(sId).push(entry);
            }
          }
        }

        const routes = (routesJson.routes || [])
          .filter((r) => !r.hidden && !r.disabled)
          .map((r) => {
            const rId = String(r.routeID);
            const stopsOrder = routeStopsMap.get(rId) || [];
            const rEtasObj = {};
            if (routeEtasMap.has(rId)) {
              for (const [stId, arr] of routeEtasMap.get(rId).entries()) {
                rEtasObj[stId] = arr.sort((a, b) => a.min - b.min);
              }
            }
            return {
              id: r.routeID,
              route_id: r.routeID,
              routeID: r.routeID,
              name: r.longName || r.shortName,
              route_name: r.longName || r.shortName,
              color: r.color ? `#${r.color}` : '#00563b',
              stops: stopsOrder,
              etas: rEtasObj,
            };
          });

        const stops = (stopsJson.stop || [])
          .filter((s) => !s.hidden && !s.disabled)
          .map((s) => {
            const sId = Number(s.stopID);
            const sEtas = (stopEtasMap.get(sId) || []).map((e) => {
              const matchedRoute = routes.find((r) => String(r.id) === e.routeId);
              return {
                ...e,
                routeName: matchedRoute?.name || 'Shuttle',
                color: matchedRoute?.color || 'var(--green-fill)',
              };
            }).sort((a, b) => a.min - b.min);

            return {
              id: s.stopID,
              stop_id: s.stopID,
              stopID: s.stopID,
              name: s.longName || s.shortName || 'Bus Stop',
              code: s.stopCode || '',
              lat: s.lat,
              lng: s.lng,
              lon: s.lng,
              etas: sEtas,
            };
          });

        return { ok: true, at: Date.now(), routes, stops };
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
