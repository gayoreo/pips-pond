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

    // 1. Routes
    if (subpath === 'routes') {
      const [routesRes, routeStopsRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!routesRes.ok) {
        throw new Error(`Peak Transit routes error: ${routesRes.statusText}`);
      }

      const routesJson = await routesRes.json();
      const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };

      // Map stop order per route
      const routeStopsMap = new Map<string, number[]>();
      for (const rs of (routeStopsJson.routeStops || [])) {
        if (!rs.disabled) {
          const rId = String(rs.routeID);
          if (!routeStopsMap.has(rId)) routeStopsMap.set(rId, []);
          routeStopsMap.get(rId)!.push(Number(rs.stopID));
        }
      }

      const routes = (routesJson.routes || [])
        .filter((r: any) => !r.hidden && !r.disabled)
        .map((r: any) => ({
          id: r.routeID,
          route_id: r.routeID,
          routeID: r.routeID,
          name: r.longName || r.shortName,
          route_name: r.longName || r.shortName,
          color: r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : '#00563b',
          stops: routeStopsMap.get(String(r.routeID)) || [],
          sequence: r.sequence,
        }));

      return reply({ routes });
    }

    // 2. Stops
    if (subpath === 'stops') {
      const routeId = params.get('route_id') || params.get('routeId');
      const [stopsRes, routeStopsRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!stopsRes.ok) {
        throw new Error(`Peak Transit stops error: ${stopsRes.statusText}`);
      }

      const stopsJson = await stopsRes.json();
      const routeStopsJson = routeStopsRes.ok ? await routeStopsRes.json() : { routeStops: [] };
      const allStops = stopsJson.stop || [];
      const routeStops = routeStopsJson.routeStops || [];

      const validStopIds = new Set<number>();
      if (routeId) {
        routeStops
          .filter((rs: any) => String(rs.routeID) === String(routeId) && !rs.disabled)
          .forEach((rs: any) => validStopIds.add(Number(rs.stopID)));
      }

      const stops = allStops
        .filter((s: any) => (!routeId || validStopIds.has(Number(s.stopID))) && !s.disabled && !s.hidden)
        .map((s: any) => ({
          id: s.stopID,
          stop_id: s.stopID,
          stopID: s.stopID,
          name: s.longName || s.shortName || 'Bus Stop',
          stop_name: s.longName || s.shortName || 'Bus Stop',
          code: s.stopCode || '',
          lat: s.lat,
          lng: s.lng,
          lon: s.lng,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      return reply({ stops });
    }

    // 3. Predictions / ETAs
    if (subpath === 'predictions' || subpath === 'eta') {
      const stopId = params.get('stop_id') || params.get('stopId');
      const [etaRes, routesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);

      if (!etaRes.ok) {
        throw new Error(`Peak Transit eta error: ${etaRes.statusText}`);
      }

      const etaJson = await etaRes.json();
      const routesJson = routesRes.ok ? await routesRes.json() : { routes: [] };
      const routeMap = new Map();
      (routesJson.routes || []).forEach((r: any) => {
        routeMap.set(String(r.routeID), {
          name: r.longName || r.shortName,
          color: r.color ? (r.color.startsWith('#') ? r.color : `#${r.color}`) : '#00563b',
        });
      });

      const stopsEta = etaJson.stop || [];
      const predictions: any[] = [];
      const nowSec = Math.floor(Date.now() / 1000);

      for (const item of stopsEta) {
        if (!stopId || String(item.stopID) === String(stopId)) {
          const routeInfo = routeMap.get(String(item.routeID)) || { name: 'Shuttle', color: 'var(--green-fill)' };
          for (const etaKey of ['ETA1', 'ETA2']) {
            const ts = item[etaKey];
            if (ts && ts > nowSec) {
              const min = Math.max(0, Math.round((ts - nowSec) / 60));
              predictions.push({
                routeName: routeInfo.name,
                routeId: String(item.routeID),
                stopId: String(item.stopID),
                min,
                eta: new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                vehicle: String(item.vehicleID || item.busID || ''),
                color: routeInfo.color,
                timestamp: ts,
              });
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

      const routeStopsMap = new Map<string, number[]>();
      for (const rs of (routeStopsJson.routeStops || [])) {
        if (!rs.disabled) {
          const rId = String(rs.routeID);
          if (!routeStopsMap.has(rId)) routeStopsMap.set(rId, []);
          routeStopsMap.get(rId)!.push(Number(rs.stopID));
        }
      }

      const stopEtasMap = new Map<number, any[]>();
      const routeEtasMap = new Map<string, Map<number, any[]>>();

      for (const item of (etaJson.stop || [])) {
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
              eta: new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
              vehicle: String(item.vehicleID || item.busID || ''),
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
