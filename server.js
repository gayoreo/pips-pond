import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Proxy endpoint for Peak Transit API to bypass CORS
app.all(['/api/bus', '/functions/v1/bus', '/functions/v1/bus/*'], async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }

  try {
    let endpoint = req.query.endpoint || req.query.path || '';
    if (!endpoint && req.body && (req.body.endpoint || req.body.path)) {
      endpoint = req.body.endpoint || req.body.path;
    }
    if (!endpoint) {
      const match = req.path.match(/\/bus\/(.+)/);
      if (match) endpoint = match[1];
    }
    endpoint = (endpoint || 'routes').replace(/^\/+/, '');

    const targetUrl = new URL(endpoint, 'https://uvm.rider.peaktransit.com/api/v1/');
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'endpoint' && k !== 'path') {
        targetUrl.searchParams.set(k, v);
      }
    }
    if (req.body && typeof req.body === 'object') {
      for (const [k, v] of Object.entries(req.body)) {
        if (k !== 'endpoint' && k !== 'path' && v !== undefined && v !== null) {
          targetUrl.searchParams.set(k, String(v));
        }
      }
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; PipsPond/1.0)',
      },
    });

    if (upstream.ok) {
      const data = await upstream.json();
      return res.json(data);
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
