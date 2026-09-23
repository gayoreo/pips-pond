// Campus weather from Open-Meteo (free, no key, no sign-up). One call gives the current temp,
// how it feels, today's high and low and the chance of rain. Cached for half an hour so opening
// the Pond doesn't refetch every time, and the last reading is kept for when you're offline.
const CACHE_KEY = 'pips-pond:weather';
const FRESH_MS = 30 * 60 * 1000;

// Where to read the weather. Defaults to campus; change it in Study settings.
export const DEFAULT_CAMPUS = { lat: 44.4759, lon: -73.2121, name: 'Burlington, VT' };

export function campusOf(profile) {
  const c = profile?.campus ?? {};
  const lat = Number(c.lat);
  const lon = Number(c.lon);
  return Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon, name: (c.name || '').trim() }
    : { ...DEFAULT_CAMPUS };
}

// WMO weather codes -> a short label and an emoji.
const CODES = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤'], 2: ['Partly cloudy', '⛅'], 3: ['Cloudy', '☁️'],
  45: ['Fog', '🌫'], 48: ['Fog', '🌫'],
  51: ['Drizzle', '🌦'], 53: ['Drizzle', '🌦'], 55: ['Drizzle', '🌦'], 56: ['Freezing drizzle', '🌧'], 57: ['Freezing drizzle', '🌧'],
  61: ['Rain', '🌧'], 63: ['Rain', '🌧'], 65: ['Heavy rain', '🌧'], 66: ['Freezing rain', '🌧'], 67: ['Freezing rain', '🌧'],
  71: ['Snow', '🌨'], 73: ['Snow', '🌨'], 75: ['Heavy snow', '🌨'], 77: ['Snow', '🌨'],
  80: ['Showers', '🌦'], 81: ['Showers', '🌧'], 82: ['Heavy showers', '⛈'], 85: ['Snow showers', '🌨'], 86: ['Snow showers', '🌨'],
  95: ['Thunderstorm', '⛈'], 96: ['Thunderstorm', '⛈'], 99: ['Thunderstorm', '⛈'],
};
export const codeInfo = (code) => CODES[code] ?? ['Weather', '🌡'];

export const SNOW_CODES = [71, 73, 75, 77, 85, 86];
export const RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];

// A simple bucket for Pip's tone: snow / rain / cold / hot / mild.
export function weatherBucket(code, tempF) {
  if (SNOW_CODES.includes(code)) return 'snow';
  if (RAIN_CODES.includes(code)) return 'rain';
  if (tempF <= 40) return 'cold';
  if (tempF >= 82) return 'hot';
  return 'mild';
}

function readCache(lat, lon) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || c.lat !== lat || c.lon !== lon) return null;
    return { data: c.data, fresh: Date.now() - c.at < FRESH_MS };
  } catch { return null; }
}

// { tempF, feelsF, code, label, icon, hiF, loF, precipProb, bucket } or null if it can't be read.
export async function getWeather(campus) {
  const { lat, lon } = campus;
  const cached = readCache(lat, lon);
  if (cached?.fresh) return cached.data;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,apparent_temperature,weather_code,precipitation'
      + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
      + '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=1';
    const r = await fetch(url);
    if (!r.ok) throw new Error('weather');
    const j = await r.json();
    const cur = j.current ?? {};
    const day = j.daily ?? {};
    const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
    const code = num(cur.weather_code ?? day.weather_code?.[0]) ?? 0;
    const tempF = num(cur.temperature_2m);
    if (tempF === null) throw new Error('weather');
    const [label, icon] = codeInfo(code);
    const data = {
      tempF, feelsF: num(cur.apparent_temperature) ?? tempF, code, label, icon,
      hiF: num(day.temperature_2m_max?.[0]), loF: num(day.temperature_2m_min?.[0]),
      precipProb: num(day.precipitation_probability_max?.[0]) ?? 0,
      bucket: weatherBucket(code, tempF),
    };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lon, at: Date.now(), data })); } catch { /* private mode */ }
    return data;
  } catch {
    return cached?.data ?? null; // last known reading, if we have one
  }
}