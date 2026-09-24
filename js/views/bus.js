// Campus Bus Tracker: A-to-B trip planner for UVM CATS shuttles.
import { loadBus, planTrip, pickTwo } from '../data/bus.js';
import { esc } from '../ui/dom.js';

const STORAGE_FROM = 'pips:bus:from';
const STORAGE_TO = 'pips:bus:to';

const state = {
  feed: null,
  startStopId: '',
  endStopId: '',
  loading: false,
  error: null,
  timer: null,
};

let currentRoot = null;

// Popular campus destination shortcuts
const POPULAR_STOPS = [
  { name: 'Davis Center', match: /davis/i },
  { name: 'Redstone Apts', match: /redstone.*apt/i },
  { name: 'Coolidge Hall', match: /coolidge/i },
  { name: 'Billings Library', match: /billings/i },
  { name: 'Waterman', match: /waterman/i },
  { name: 'Patrick Gym / PFG', match: /pfg|athletic|patrick/i },
];

function getSavedStops(stops = []) {
  let fromId = '';
  let toId = '';

  try {
    fromId = sessionStorage.getItem(STORAGE_FROM) || localStorage.getItem(STORAGE_FROM) || '';
    toId = sessionStorage.getItem(STORAGE_TO) || localStorage.getItem(STORAGE_TO) || '';
  } catch {
    // Ignore storage restrictions
  }

  const validIds = new Set(stops.map((s) => String(s.id)));

  if (!fromId || !validIds.has(fromId)) {
    // Default origin: e.g. Coolidge or Redstone or first stop
    const defaultFrom = stops.find((s) => /coolidge|redstone/i.test(s.name)) || stops[0];
    fromId = defaultFrom ? String(defaultFrom.id) : '';
  }

  if (!toId || !validIds.has(toId) || toId === fromId) {
    // Default destination: Davis Center or Billings Library or second stop
    const defaultTo = stops.find((s) => /davis|billings|waterman/i.test(s.name) && String(s.id) !== fromId) ||
      stops.find((s) => String(s.id) !== fromId) || stops[1] || stops[0];
    toId = defaultTo ? String(defaultTo.id) : '';
  }

  return { fromId, toId };
}

function saveStops(fromId, toId) {
  try {
    if (fromId) {
      sessionStorage.setItem(STORAGE_FROM, fromId);
      localStorage.setItem(STORAGE_FROM, fromId);
    }
    if (toId) {
      sessionStorage.setItem(STORAGE_TO, toId);
      localStorage.setItem(STORAGE_TO, toId);
    }
  } catch {
    // Ignore storage restrictions
  }
}

function renderUI() {
  if (!currentRoot) return;

  const { feed, startStopId, endStopId, loading, error } = state;
  const stops = feed?.stops || [];
  const startStop = stops.find((s) => String(s.id) === String(startStopId));
  const endStop = stops.find((s) => String(s.id) === String(endStopId));

  // Determine trips between start and end
  let trips = [];
  let matchingRoutes = [];
  let isConnected = false;

  if (feed && startStopId && endStopId && startStopId !== endStopId) {
    matchingRoutes = (feed.routes || []).filter((r) => {
      const rStops = (r.stops || []).map(String);
      return rStops.includes(String(startStopId)) && rStops.includes(String(endStopId));
    });

    isConnected = matchingRoutes.length > 0;
    trips = planTrip(feed, { from: startStopId, to: endStopId });
  }

  const { best, backup } = pickTwo(trips);
  const remainingTrips = trips.filter((t) => t !== best && t !== backup);

  // Quick preset chips that match actual stops in this feed
  const presetChips = POPULAR_STOPS.map((p) => {
    const found = stops.find((s) => p.match.test(s.name));
    return found ? { label: p.name, stopId: String(found.id) } : null;
  }).filter(Boolean);

  currentRoot.innerHTML = `
    <div class="deck-page stack">
      <div class="sheet__head">
        <a class="btn-plain btn-plain--muted" href="#/pond">‹ pond</a>
        <span class="spacer"></span>
        <button type="button" class="btn-plain" data-action="refresh" title="Refresh live arrivals">
          ↻ ${loading ? 'updating…' : 'refresh'}
        </button>
      </div>

      <header class="deck-head" style="--course: var(--green-fill)">
        <p class="eyebrow">UVM CATS Shuttle</p>
        <h1 class="page-title">Bus Tracker 🚌</h1>
        <p class="card__hint">Live loop transit & arrival predictions</p>
      </header>

      <!-- A-to-B Stop Selector -->
      <section class="card stack">
        <label class="field">
          <span>From (Start Stop)</span>
          <select name="startStop" class="btn-plain" style="width: 100%; text-align: left; padding: 10px; border: 2px solid var(--ink); border-radius: 8px; background: var(--paper); font-size: 15px; font-weight: 700;">
            ${stops.map((s) => `
              <option value="${esc(s.id)}"${String(s.id) === String(startStopId) ? ' selected' : ''}>
                ${esc(s.name)}${s.etas && s.etas.length > 0 ? ` (${s.etas.length} bus)` : ''}
              </option>
            `).join('')}
          </select>
        </label>

        <div style="display: flex; justify-content: center; margin: -4px 0;">
          <button type="button" class="btn-sketch" data-action="swap" style="font-size: 14px; padding: 4px 14px;">
            ⇅ Swap Stops
          </button>
        </div>

        <label class="field">
          <span>To (End Stop)</span>
          <select name="endStop" class="btn-plain" style="width: 100%; text-align: left; padding: 10px; border: 2px solid var(--ink); border-radius: 8px; background: var(--paper); font-size: 15px; font-weight: 700;">
            ${stops.map((s) => `
              <option value="${esc(s.id)}"${String(s.id) === String(endStopId) ? ' selected' : ''}>
                ${esc(s.name)}
              </option>
            `).join('')}
          </select>
        </label>

        ${presetChips.length > 0 ? `
          <div style="margin-top: 6px;">
            <p class="card__hint" style="margin-bottom: 6px;">Quick destinations:</p>
            <div class="chip-row">
              ${presetChips.map((chip) => `
                <button type="button" class="course-chip" data-quick-dest="${esc(chip.stopId)}" style="--course: ${String(chip.stopId) === String(endStopId) ? 'var(--yellow-note)' : 'var(--card)'}">
                  ${esc(chip.label)}
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>

      <!-- Trip Results Section -->
      <section class="stack">
        ${loading && !feed ? `
          <div class="card bus-result">
            <p class="hand">Finding shuttles…</p>
            <p class="card__hint">Connecting to Peak Transit live feed…</p>
          </div>
        ` : ''}

        ${error ? `
          <div class="card bus-result">
            <p class="hand">Couldn't load transit data</p>
            <p class="card__hint">${esc(error)}</p>
            <button type="button" class="btn-sketch btn-sketch--go" data-action="refresh">Try again</button>
          </div>
        ` : ''}

        ${!loading && !error && startStopId && endStopId && startStopId === endStopId ? `
          <div class="card bus-result">
            <p class="hand">You're already there! 🐸</p>
            <p class="card__hint">Choose a different destination stop to plan your trip.</p>
          </div>
        ` : ''}

        ${!loading && !error && startStopId !== endStopId && !isConnected && feed ? `
          <div class="card bus-result">
            <p class="hand">No direct loop connection</p>
            <p class="card__hint">
              No active campus shuttle connects <b>${esc(startStop?.name || 'origin')}</b> directly to <b>${esc(endStop?.name || 'destination')}</b> in this direction.
            </p>
            <p class="card__hint">Try swapping direction or picking another stop.</p>
          </div>
        ` : ''}

        ${!loading && !error && startStopId !== endStopId && isConnected && trips.length === 0 ? `
          <div class="card bus-result">
            <p class="hand">No shuttles running right now</p>
            <p class="card__hint">
              Route: <b>${esc(matchingRoutes.map((r) => r.name).join(', '))}</b> connects these stops, but there are no active buses currently predicting on this loop.
            </p>
            <p class="card__hint">Campus shuttles run standard hours during the academic week.</p>
            <button type="button" class="btn-sketch" data-action="refresh">↻ Check again</button>
          </div>
        ` : ''}

        <!-- Best Primary Option -->
        ${best ? `
          <div class="card bus-result">
            <p class="bus-take" style="--route: ${esc(best.routeColor)}">
              Take <b>${esc(best.routeName)}</b> in <b>${best.busIn} min</b>
            </p>
            <p class="bus-route">
              <b>${best.stopsCount}</b> ${best.stopsCount === 1 ? 'stop' : 'stops'} · ~<b>${best.rideMinutes} min</b> ride to ${esc(endStop?.name || 'destination')}
            </p>
            <p class="card__hint">
              Arrives at ${esc(startStop?.name || 'Stop')} around <b>${esc(best.eta)}</b> · Reaches ${esc(endStop?.name || 'Destination')} ~<b>${esc(best.arriveEta)}</b>
              ${best.vehicle ? ` · Bus #${esc(best.vehicle)}` : ''}
            </p>
          </div>
        ` : ''}

        <!-- Secondary / Backup Option -->
        ${backup ? `
          <div class="card bus-result bus-result--backup">
            <p class="bus-take" style="--route: ${esc(backup.routeColor)}">
              Next bus: <b>${esc(backup.routeName)}</b> in <b>${backup.busIn} min</b>
            </p>
            <p class="bus-route">
              Departs ${esc(backup.eta)} · Arrives destination ~<b>${esc(backup.arriveEta)}</b> (${backup.stopsCount} stops)
            </p>
          </div>
        ` : ''}

        <!-- Later Trips if any -->
        ${remainingTrips.length > 0 ? `
          <div class="stack" style="margin-top: 8px;">
            <p class="card__hint">Later departures:</p>
            ${remainingTrips.slice(0, 3).map((t) => `
              <div class="card bus-result bus-result--backup" style="opacity: 0.85;">
                <p class="bus-take" style="--route: ${esc(t.routeColor)}; font-size: 15px;">
                  <b>${esc(t.routeName)}</b> in <b>${t.busIn} min</b> (${esc(t.eta)})
                </p>
                <p class="bus-route" style="font-size: 13px;">
                  Arrives ~${esc(t.arriveEta)} · ${t.stopsCount} stops
                </p>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </section>

      <!-- Live Routes Summary -->
      ${feed?.routes && feed.routes.length > 0 ? `
        <section class="stack" style="margin-top: 14px;">
          <p class="hand" style="margin-bottom: 2px;">Campus Routes</p>
          <div class="chip-row">
            ${feed.routes.map((r) => `
              <span class="course-chip" style="--course: ${esc(r.color || 'var(--green-fill)')}; cursor: default;">
                ${esc(r.name)} (${r.stops ? r.stops.length : 0} stops)
              </span>
            `).join('')}
          </div>
        </section>
      ` : ''}
    </div>
  `;

  attachHandlers();
}

function attachHandlers() {
  if (!currentRoot) return;

  const startSelect = currentRoot.querySelector('select[name="startStop"]');
  const endSelect = currentRoot.querySelector('select[name="endStop"]');

  startSelect?.addEventListener('change', (e) => {
    state.startStopId = e.target.value;
    saveStops(state.startStopId, state.endStopId);
    renderUI();
  });

  endSelect?.addEventListener('change', (e) => {
    state.endStopId = e.target.value;
    saveStops(state.startStopId, state.endStopId);
    renderUI();
  });

  currentRoot.addEventListener('click', (e) => {
    // Swap origin and destination
    if (e.target.closest('[data-action="swap"]')) {
      const temp = state.startStopId;
      state.startStopId = state.endStopId;
      state.endStopId = temp;
      saveStops(state.startStopId, state.endStopId);
      renderUI();
      return;
    }

    // Refresh live predictions
    if (e.target.closest('[data-action="refresh"]')) {
      loadData(false);
      return;
    }

    // Quick destination button
    const quickBtn = e.target.closest('[data-quick-dest]');
    if (quickBtn) {
      const destId = quickBtn.dataset.quickDest;
      if (destId === state.startStopId) {
        state.startStopId = state.endStopId;
      }
      state.endStopId = destId;
      saveStops(state.startStopId, state.endStopId);
      renderUI();
    }
  });
}

async function loadData(showFullLoading = true) {
  if (showFullLoading) {
    state.loading = true;
    state.error = null;
    renderUI();
  }

  try {
    const feed = await loadBus();
    if (!feed || !feed.ok) {
      throw new Error(feed?.error || 'Failed to fetch bus routes from server.');
    }

    state.feed = feed;
    state.error = null;

    // Initialize default selections if not already chosen
    const stops = feed.stops || [];
    if (!state.startStopId || !state.endStopId) {
      const { fromId, toId } = getSavedStops(stops);
      state.startStopId = fromId;
      state.endStopId = toId;
      saveStops(fromId, toId);
    }
  } catch (err) {
    console.error('[renderBus] Load error:', err);
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    renderUI();
  }
}

export async function renderBus(root) {
  currentRoot = root;

  // Clear existing timer if any
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  await loadData(true);

  // Auto-refresh ETAs every 30 seconds while on this view
  state.timer = setInterval(() => {
    if (location.hash === '#/bus') {
      loadData(false);
    } else {
      clearInterval(state.timer);
      state.timer = null;
    }
  }, 30000);
}
