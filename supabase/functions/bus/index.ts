// Supabase Edge Function to proxy requests to Peak Transit API (UVM CATS)
// Bypasses browser CORS restrictions.
//
// Target: https://uvm.rider.peaktransit.com/api/v1/

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const PEAK_BASE = 'https://uvm.rider.peaktransit.com/api/v1/';

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
    let endpoint = '';
    const params = new URLSearchParams();
    const reqUrl = new URL(req.url);

    // 1. Extract subpath if called like /functions/v1/bus/routes or /functions/v1/bus/stops
    const busIdx = reqUrl.pathname.indexOf('/bus');
    if (busIdx !== -1) {
      const sub = reqUrl.pathname.slice(busIdx + 4).replace(/^\/+/, '');
      if (sub) endpoint = sub;
    }

    // 2. Read JSON body if POST
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body.endpoint) endpoint = body.endpoint;
      if (body.path) endpoint = body.path;
      for (const [k, v] of Object.entries(body)) {
        if (k !== 'endpoint' && k !== 'path' && v !== undefined && v !== null) {
          params.set(k, String(v));
        }
      }
    }

    // 3. Read query searchParams
    for (const [k, v] of reqUrl.searchParams.entries()) {
      if (k === 'endpoint' || k === 'path') {
        if (!endpoint) endpoint = v;
      } else {
        params.set(k, v);
      }
    }

    endpoint = endpoint.replace(/^\/+/, '') || 'routes';

    // Construct full target URL for Peak Transit
    const targetUrl = new URL(endpoint, PEAK_BASE);
    for (const [k, v] of params.entries()) {
      targetUrl.searchParams.set(k, v);
    }

    const res = await fetch(targetUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; PipsPond/1.0)',
      },
    });

    if (!res.ok) {
      return reply({ error: `Peak Transit API error: ${res.statusText}`, status: res.status }, res.status);
    }

    const json = await res.json();
    return reply(json);
  } catch (err) {
    console.error('Bus proxy error:', err);
    return reply({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
