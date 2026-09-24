// Supabase Edge Function to proxy requests to Peak Transit API (UVM CATS)
// Bypasses browser CORS restrictions.
//
// Primary Target: https://uvm.rider.peaktransit.com/api/v1/
// Live Fallback Target: https://api.peaktransit.com/v5/index.php (Official Peak Transit API)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const PEAK_BASE = 'https://uvm.rider.peaktransit.com/api/v1/';
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

/**
 * Fallback to official Peak Transit v5 API when /api/v1/ returns 404
 */
async function fallbackPeakTransit(endpoint: string, queryParams: URLSearchParams) {
  try {
    if (endpoint === 'routes') {
      const res = await fetch(`${BPT_API_BASE}&controller=route2&action=list`, {
        headers: SPOOFED_HEADERS,
      });
      if (res.ok) {
        const json = await res.json();
        const routes = (json.routes || [])
          .map((r: any) => ({
            id: r.routeID,
            route_id: r.routeID,
            routeID: r.routeID,
            name: r.longName || r.shortName,
            route_name: r.longName || r.shortName,
            color: r.color ? `#${r.color}` : '#00563b',
            hidden: r.hidden,
            disabled: r.disabled,
          }))
          .filter((r: any) => !r.hidden && !r.disabled);
        return { routes };
      }
    } else if (endpoint === 'stops') {
      const routeId = queryParams.get('route_id') || queryParams.get('routeId');
      const [stopsRes, routeStopsRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=stop2&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=routestop2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (stopsRes.ok && routeStopsRes.ok) {
        const stopsJson = await stopsRes.json();
        const routeStopsJson = await routeStopsRes.json();
        const allStops = stopsJson.stop || [];
        const routeStops = routeStopsJson.routeStops || [];

        const validStopIds = new Set<number>();
        if (routeId) {
          routeStops
            .filter((rs: any) => String(rs.routeID) === String(routeId) && !rs.disabled)
            .forEach((rs: any) => validStopIds.add(rs.stopID));
        }

        const filteredStops = allStops
          .filter((s: any) => (!routeId || validStopIds.has(s.stopID)) && !s.disabled && !s.hidden)
          .map((s: any) => ({
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
      const stopId = queryParams.get('stop_id') || queryParams.get('stopId');
      const [etaRes, routesRes] = await Promise.all([
        fetch(`${BPT_API_BASE}&controller=eta&action=list`, { headers: SPOOFED_HEADERS }),
        fetch(`${BPT_API_BASE}&controller=route2&action=list`, { headers: SPOOFED_HEADERS }),
      ]);
      if (etaRes.ok) {
        const etaJson = await etaRes.json();
        const routesJson = routesRes.ok ? await routesRes.json() : { routes: [] };
        const routeMap = new Map();
        (routesJson.routes || []).forEach((r: any) => {
          routeMap.set(String(r.routeID), {
            name: r.longName || r.shortName,
            color: r.color ? `#${r.color}` : '#00563b',
          });
        });

        const stopsEta = etaJson.stop || [];
        const predictions: any[] = [];
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
  } catch (fbErr) {
    console.error('[Bus Proxy Fallback Error]', fbErr);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const reqUrl = new URL(req.url);

    // 1. Strip the '/bus/' prefix from the path to get the endpoint subpath
    let subpath = '';
    const busMatch = reqUrl.pathname.match(/\/bus(?:\/(.*))?$/);
    if (busMatch && busMatch[1]) {
      subpath = busMatch[1];
    } else if (reqUrl.searchParams.has('endpoint')) {
      subpath = reqUrl.searchParams.get('endpoint')!;
    } else if (reqUrl.searchParams.has('path')) {
      subpath = reqUrl.searchParams.get('path')!;
    }

    // Clean leading slashes and default to 'routes'
    subpath = subpath.replace(/^\/+/, '') || 'routes';

    // 2. Append the rest of the path to https://uvm.rider.peaktransit.com/api/v1/
    const targetUrl = new URL(`https://uvm.rider.peaktransit.com/api/v1/${subpath}`);

    // Forward all query parameters
    for (const [key, value] of reqUrl.searchParams.entries()) {
      if (key !== 'endpoint' && key !== 'path') {
        targetUrl.searchParams.set(key, value);
      }
    }

    console.log(`[Bus Proxy] Forwarding GET request to: ${targetUrl.toString()}`);

    // 3. Outbound fetch with spoofed browser User-Agent, Accept, and Origin
    const res = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: SPOOFED_HEADERS,
    });

    if (res.ok) {
      const json = await res.json();
      return reply(json);
    }

    // If Peak Transit returns an error status (e.g. 404 Not Found), log it
    const errBody = await res.text().catch(() => '');
    console.error(`[Bus Proxy Upstream Error] HTTP ${res.status} ${res.statusText} from ${targetUrl.toString()}:`, errBody);

    // If the legacy /api/v1/ path 404s, seamlessly resolve via Peak Transit's live v5 API
    if (res.status === 404 || res.status === 502) {
      console.warn(`[Bus Proxy] ${targetUrl.toString()} returned ${res.status}. Attempting Peak Transit live v5 API resolution...`);
      const fallbackResult = await fallbackPeakTransit(subpath, reqUrl.searchParams);
      if (fallbackResult) {
        return reply(fallbackResult);
      }
    }

    return reply(
      {
        error: `Peak Transit API error: ${res.statusText}`,
        status: res.status,
        url: targetUrl.toString(),
        details: errBody.slice(0, 500),
      },
      res.status
    );
  } catch (err: unknown) {
    // 4. Robust console.error logging in catch block
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error('[Bus Proxy Exception] Internal error occurred while proxying transit request:', {
      error: errorMsg,
      stack: errorStack,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    return reply(
      {
        error: 'Bus proxy internal error',
        message: errorMsg,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});
