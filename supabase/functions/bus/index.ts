// Supabase Edge Function to proxy requests to Peak Transit API (UVM CATS)
// Bypasses browser CORS restrictions.
// Exclusively communicates with the official Peak Transit v5 API.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const BPT_API_BASE = 'https://api.peaktransit.com/v5/index.php?app_id=_RIDER&key=c620b8fe5fdbd6107da8c8381f4345b4&agencyID=159';

const SPOOFED_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://uvm.rider.peaktransit.com',
  'Referer': 'https://uvm.rider.peaktransit.com/',
  'Accept-Language': 'en-US,en;q=0.9',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const reqUrl = new URL(req.url);

    // Extract endpoint subpath after '/bus/'
    let subpath = '';
    const busMatch = reqUrl.pathname.match(/\/bus(?:\/(.*))?$/);
    if (busMatch && busMatch[1]) {
      subpath = busMatch[1];
    } else if (reqUrl.searchParams.has('endpoint')) {
      subpath = reqUrl.searchParams.get('endpoint')!;
    } else if (reqUrl.searchParams.has('path')) {
      subpath = reqUrl.searchParams.get('path')!;
    }

    subpath = subpath.replace(/^\/+/, '') || 'routes';
    const params = reqUrl.searchParams;

    console.log(`[Bus Proxy v5] Processing subpath: "${subpath}" with params:`, Object.fromEntries(params.entries()));

    // Helper: Squared distance
    const distSq = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const dLat = (lat2 - lat1) * 111000;
      const dLon = (lon2 - lon1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
      return dLat * dLat + dLon * dLon;
    };

    // 1. Routes (Ordered along shape path)
    if (subpath === 'routes') {
      const [routesRes, routeStopsRes, stopsRes, shapesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=shape2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!routesRes.ok) {
        throw new Error(`Peak Transit routes error: ${routesRes.statusText}`);
      }

      const routesJson = await routesRes.json();
      const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
      const stopsJson = stopsRes.ok ? await stopsRes.json() : { stop: [] };
      const shapesJson = shapesRes.ok ? await shapesRes.json() : { shape: [] };

      const stopMap = new Map<string, any>();
      for (const s of (stopsJson.stop || [])) {
        stopMap.set(String(s.stopID), s);
      }

      // Group active shapes by routeID
      const shapesByRoute = new Map<string, any>();
      for (const sh of (shapesJson.shape || [])) {
        if (!sh.disabled && sh.points) {
          const rId = String(sh.routeID);
          if (!shapesByRoute.has(rId)) shapesByRoute.set(rId, sh);
        }
      }

      // Group active route stops by routeID
      const routeStopsByRoute = new Map<string, any[]>();
      for (const rs of (routeStopsJson.routeStops || [])) {
        if (!rs.disabled) {
          const rId = String(rs.routeID);
          if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
          routeStopsByRoute.get(rId)!.push(rs);
        }
      }

      // Order stops along route shape coordinates
      const routeStopsMap = new Map<string, string[]>();
      for (const [rId, rsList] of routeStopsByRoute.entries()) {
        const shape = shapesByRoute.get(rId);
        if (shape && shape.points && rsList.length > 0) {
          const points = shape.points.split(';').filter(Boolean).map((pt: string) => {
            const [lat, lng] = pt.split(',').map(Number);
            return { lat, lng };
          });

          const pos = rsList.map((rs: any) => {
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

          pos.sort((a: any, b: any) => a.idx - b.idx);
          routeStopsMap.set(rId, pos.map((p: any) => p.stopId));
        } else {
          rsList.sort((a: any, b: any) => {
            const orderA = Number(a.sortOrder ?? a.sequence ?? a.routeStopID ?? 0);
            const orderB = Number(b.sortOrder ?? b.sequence ?? b.routeStopID ?? 0);
            return orderA - orderB;
          });
          routeStopsMap.set(rId, rsList.map((rs: any) => String(rs.stopID)));
        }
      }

      const routes = (routesJson.routes || [])
        .filter((r: any) => !r.hidden && !r.disabled)
        .map((r: any) => ({
          id: String(r.routeID),
          name: r.longName || r.shortName,
          color: r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : '#00563b',
          stops: routeStopsMap.get(String(r.routeID)) || [],
        }));

      return reply({ routes });
    }

    // 2. Stops (Active route stops only, eliminating dead orphan stops)
    if (subpath === 'stops') {
      const [stopsRes, routeStopsRes, routesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!stopsRes.ok) {
        throw new Error(`Peak Transit stops error: ${stopsRes.statusText}`);
      }

      const stopsJson = await stopsRes.json();
      const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
      const routesJson = routesRes.ok ? await routesRes.json() : { routes: [] };

      const activeRouteIds = new Set<string>();
      (routesJson.routes || []).forEach((r: any) => {
        if (!r.hidden && !r.disabled) activeRouteIds.add(String(r.routeID));
      });

      const activeStopIds = new Set<string>();
      const stopRoutesMap = new Map<string, string[]>();
      (routeStopsJson.routeStops || []).forEach((rs: any) => {
        const rId = String(rs.routeID);
        if (!rs.disabled && (activeRouteIds.size === 0 || activeRouteIds.has(rId))) {
          const sId = String(rs.stopID);
          activeStopIds.add(sId);
          if (!stopRoutesMap.has(sId)) stopRoutesMap.set(sId, []);
          if (!stopRoutesMap.get(sId)!.includes(rId)) {
            stopRoutesMap.get(sId)!.push(rId);
          }
        }
      });

      const allStops = stopsJson.stop || [];
      const stops = allStops
        .filter((s: any) => !s.disabled && !s.hidden && (activeStopIds.size === 0 || activeStopIds.has(String(s.stopID))))
        .map((s: any) => ({
          id: String(s.stopID),
          name: s.longName || s.shortName || 'Bus Stop',
          code: s.stopCode || '',
          lat: s.lat,
          lng: s.lng,
          routes: stopRoutesMap.get(String(s.stopID)) || [],
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      return reply({ stops });
    }

    // 3. Predictions / ETAs (High-accuracy: matches physical GPS vehicles, eliminates ghost buses)
    if (subpath === 'predictions' || subpath === 'eta') {
      const stopId = params.get('stop_id') || params.get('stopId');
      const [etaRes, vehRes, stopsRes, routeStopsRes, shapesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=vehicle&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=shape2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!etaRes.ok && !vehRes.ok) {
        throw new Error('Peak Transit transit error');
      }

      const etaJson = etaRes.ok ? await etaRes.json() : { stop: [] };
      const vehJson = vehRes.ok ? await vehRes.json() : { vehicle: [] };
      const stopsJson = stopsRes.ok ? await stopsRes.json() : { stop: [] };
      const rsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
      const shapesJson = shapesRes.ok ? await shapesRes.json() : { shape: [] };

      const nowSec = Math.floor(Date.now() / 1000);
      const stopMap = new Map<string, any>();
      (stopsJson.stop || []).forEach((s: any) => stopMap.set(String(s.stopID), s));

      // Active physical vehicles currently in service
      const rawVehicles = Array.isArray(vehJson.vehicle) ? vehJson.vehicle : [];
      const activeVehicles = rawVehicles.filter((v: any) => v.oos === 0 && Number(v.routeID) > 0);

      const vehiclesByRoute = new Map<string, any[]>();
      activeVehicles.forEach((v: any) => {
        const rId = String(v.routeID);
        if (!vehiclesByRoute.has(rId)) vehiclesByRoute.set(rId, []);
        vehiclesByRoute.get(rId)!.push(v);
      });

      const predictions: any[] = [];
      const processedKeys = new Set<string>();

      // 1. Process eta controller items strictly for routes with active vehicles (discarding ghost buses)
      const stopsEta = Array.isArray(etaJson.stop) ? etaJson.stop : [];
      for (const item of stopsEta) {
        const rId = String(item.routeID);
        const sId = String(item.stopID);

        // If active vehicles are known, discard any route without an active physical bus
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
          for (const etaKey of ['ETA1', 'ETA2']) {
            const ts = item[etaKey];
            if (ts && ts > nowSec) {
              let min = Math.max(0, Math.round((ts - nowSec) / 60));
              // If bus is physically at the stop (<= 65m) and arriving soon, mark as arriving now (0 min)
              if (etaKey === 'ETA1' && closestDist <= 65) {
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

      // 2. Loop-propagated GPS ETAs for active vehicles whose routes/stops lack timetable entries
      if (activeVehicles.length > 0) {
        const shapesByRoute = new Map<string, any>();
        for (const sh of (shapesJson.shape || [])) {
          if (!sh.disabled && sh.points) shapesByRoute.set(String(sh.routeID), sh);
        }

        const routeStopsByRoute = new Map<string, any[]>();
        for (const rs of (rsJson.routeStops || [])) {
          if (!rs.disabled) {
            const rId = String(rs.routeID);
            if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
            routeStopsByRoute.get(rId)!.push(rs);
          }
        }

        for (const [rId, vList] of vehiclesByRoute.entries()) {
          const rsList = routeStopsByRoute.get(rId) || [];
          if (rsList.length < 2) continue;

          // Ordered loop stop IDs
          const shape = shapesByRoute.get(rId);
          let loopStops: string[] = [];
          if (shape && shape.points) {
            const points = shape.points.split(';').filter(Boolean).map((pt: string) => {
              const [lat, lng] = pt.split(',').map(Number);
              return { lat, lng };
            });
            const pos = rsList.map((rs: any) => {
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
            pos.sort((a: any, b: any) => a.idx - b.idx);
            loopStops = pos.map((p: any) => p.stopId);
          } else {
            loopStops = rsList.map((rs: any) => String(rs.stopID));
          }

          for (const v of vList) {
            let vStopIdx = -1;
            if (v.nextStopID && loopStops.includes(String(v.nextStopID))) {
              vStopIdx = loopStops.indexOf(String(v.nextStopID));
            } else {
              let minD = Infinity;
              loopStops.forEach((sId: string, idx: number) => {
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
      return reply({ predictions });
    }

    // 4. Unified Feed (Routes + Stops + Live ETAs)
    if (subpath === 'feed' || subpath === 'all') {
      const [routesRes, stopsRes, routeStopsRes, etaRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!routesRes.ok || !stopsRes.ok) {
        throw new Error('Peak Transit feed error retrieving routes or stops');
      }

      const routesJson = await routesRes.json();
      const stopsJson = await stopsRes.json();
      const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
      const etaJson = etaRes.ok ? await etaRes.json() : { stop: [] };
      const nowSec = Math.floor(Date.now() / 1000);

      const routeStopsByRoute = new Map<string, any[]>();
      for (const rs of (routeStopsJson.routeStops || [])) {
        if (!rs.disabled) {
          const rId = String(rs.routeID);
          if (!routeStopsByRoute.has(rId)) routeStopsByRoute.set(rId, []);
          routeStopsByRoute.get(rId)!.push(rs);
        }
      }

      const routeStopsMap = new Map<string, string[]>();
      for (const [rId, rsList] of routeStopsByRoute.entries()) {
        rsList.sort((a: any, b: any) => {
          const orderA = Number(a.sortOrder ?? a.sequence ?? a.routeStopID ?? 0);
          const orderB = Number(b.sortOrder ?? b.sequence ?? b.routeStopID ?? 0);
          return orderA - orderB;
        });
        routeStopsMap.set(rId, rsList.map((rs: any) => String(rs.stopID)));
      }

      const stopEtasMap = new Map<number, any[]>();
      const routeEtasMap = new Map<string, Map<number, any[]>>();

      for (const item of (etaJson.stop || [])) {
        // Ghost buses: ignore and omit entries lacking physical vehicle ID
        const vehicle = item.vehicleID ?? item.busID;
        if (vehicle === null || vehicle === undefined || String(vehicle).trim() === '') {
          continue;
        }

        const sId = Number(item.stopID);
        const rId = String(item.routeID);
        if (!stopEtasMap.has(sId)) stopEtasMap.set(sId, []);
        if (!routeEtasMap.has(rId)) routeEtasMap.set(rId, new Map());
        if (!routeEtasMap.get(rId)!.has(sId)) routeEtasMap.get(rId)!.set(sId, []);

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
            stopEtasMap.get(sId)!.push(entry);
            routeEtasMap.get(rId)!.get(sId)!.push(entry);
          }
        }
      }

      const routes = (routesJson.routes || [])
        .filter((r: any) => !r.hidden && !r.disabled)
        .map((r: any) => {
          const rId = String(r.routeID);
          const stopsOrder = routeStopsMap.get(rId) || [];
          const rEtasObj: Record<string, any[]> = {};
          if (routeEtasMap.has(rId)) {
            for (const [stId, arr] of routeEtasMap.get(rId)!.entries()) {
              rEtasObj[stId] = arr.sort((a, b) => a.min - b.min);
            }
          }
          return {
            id: r.routeID,
            route_id: r.routeID,
            routeID: r.routeID,
            name: r.longName || r.shortName,
            route_name: r.longName || r.shortName,
            color: r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : '#00563b',
            stops: stopsOrder,
            etas: rEtasObj,
          };
        });

      const stops = (stopsJson.stop || [])
        .filter((s: any) => !s.hidden && !s.disabled)
        .map((s: any) => {
          const sId = Number(s.stopID);
          const sEtas = (stopEtasMap.get(sId) || []).map((e: any) => {
            const matchedRoute = routes.find((r: any) => String(r.id) === e.routeId);
            return {
              ...e,
              routeName: matchedRoute?.name || 'Shuttle',
              color: matchedRoute?.color || 'var(--green-fill)',
            };
          }).sort((a: any, b: any) => a.min - b.min);

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
        })
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      return reply({ ok: true, at: Date.now(), routes, stops });
    }

    // Default: routes
    const defaultRes = await fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS });
    const defaultJson = await defaultRes.json();
    return reply(defaultJson);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error('[Bus Proxy v5 Error]', {
      error: errorMsg,
      stack: errorStack,
      url: req.url,
      timestamp: new Date().toISOString(),
    });

    return reply(
      {
        error: 'Bus proxy error communicating with Peak Transit v5 API',
        message: errorMsg,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});
