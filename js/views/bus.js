// Campus Bus Tracker: A-to-B trip planner for UVM CATS shuttles.
import { loadBus, planTrip, pickTwo, fetchRoutes, getWatchedTrip, saveWatchedTrip } from '../data/bus.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';

const STORAGE_FROM = 'pips:bus:from';
const STORAGE_TO = 'pips:bus:to';

const state = {
  feed: null,
  startStopId: '',
  endStopId: '',
  watchedTrip: null,
  loading: false,
  error: null,
  timer: null,
};

let currentRoot = null;

// Campus destination shortcuts including STEM and WDW
const POPULAR_STOPS = [
  { name: 'STEM', match: /stem/i },
  { name: 'WDW', match: /wdw/i },
  { name: 'Davis Center', match: /davis/i },
  { name: 'Redstone Apts', match: /redstone.*apt/i },
  { name: 'Coolidge Hall', match: /coolidge/i },
  { name: 'Billings Library', match: /billings/i },
  { name: 'Waterman', match: /waterman/i },
  { name: 'Patrick Gym / PFG', match: /pfg|athletic|patrick/i },
];

function getSavedStops(stops = [], routes = []) {
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
    const stemStop = stops.find((s) => /stem/i.test(s.name));
    const activeWithEtas = stops.find((s) => s.etas && s.etas.length > 0);
    const defaultFrom = stemStop || activeWithEtas || stops.find((s) => /coolidge|redstone/i.test(s.name)) || stops[0];
    fromId = defaultFrom ? String(defaultFrom.id) : '';
  }

  if (!toId || !validIds.has(toId) || toId === fromId) {
    const wdwStop = stops.find((s) => /wdw/i.test(s.name) && String(s.id) !== fromId);
    let defaultTo = wdwStop;
    if (!defaultTo) {
      const matchingRoute = routes.find((r) => (r.stops || []).map(String).includes(fromId));
      if (matchingRoute && matchingRoute.stops && matchingRoute.stops.length > 1) {
        const idx = matchingRoute.stops.map(String).indexOf(fromId);
        const targetIdx = (idx + Math.min(2, matchingRoute.stops.length - 1)) % matchingRoute.stops.length;
        const nextId = matchingRoute.stops[targetIdx];
        defaultTo = stops.find((s) => String(s.id) === String(nextId));
      }
    }
    if (!defaultTo) {
      defaultTo = stops.find((s) => /davis|billings|waterman/i.test(s.name) && String(s.id) !== fromId) ||
        stops.find((s) => String(s.id) !== fromId) || stops[1] || stops[0];
    }
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
    // Explicitly verify directionality using route.stops array:
    // A route is only a valid connection if the endStop exists in the array after the startStop
    // (or wraps around, since these are continuous loops).
    matchingRoutes = (feed.routes || []).map((r) => {
      const routeStops = (r.stops || []).map(String);
      if (routeStops.length < 2) return null;

      const startIdx = routeStops.indexOf(String(startStopId));
      const endIdx = routeStops.indexOf(String(endStopId));
      if (startIdx === -1 || endIdx === -1 || startIdx === endIdx) return null;

      let stopsCount = 0;
      if (endIdx > startIdx) {
        stopsCount = endIdx - startIdx;
      } else if (endIdx < startIdx) {
        // Continuous loop wrap-around
        stopsCount = (routeStops.length - startIdx) + endIdx;
      }

      if (stopsCount <= 0 || stopsCount >= routeStops.length) return null;

      return {
        ...r,
        stopsCount,
      };
    }).filter(Boolean);

    isConnected = matchingRoutes.length > 0;
    trips = planTrip(feed, { from: startStopId, to: endStopId });
  }

  const { best, backup } = pickTwo(trips);
  const remainingTrips = trips.filter((t) => t !== best && t !== backup);

  const isWatching = Boolean(
    state.watchedTrip &&
    String(state.watchedTrip.fromStopId) === String(startStopId) &&
    String(state.watchedTrip.toStopId) === String(endStopId)
  );

  state.currentTripData = (startStopId && endStopId && isConnected) ? {
    routeId: best?.route?.id || matchingRoutes[0]?.id || '',
    routeName: best?.routeName || matchingRoutes[0]?.name || 'Shuttle',
    fromStopId: String(startStopId),
    fromStopName: startStop?.name || 'Start Stop',
    toStopId: String(endStopId),
    toStopName: endStop?.name || 'End Stop',
    color: best?.routeColor || matchingRoutes[0]?.color || 'var(--green-fill)',
  } : null;

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

        ${matchingRoutes.length > 0 ? `
          <div style="margin-top: 6px; padding-top: 8px; border-top: 1px dashed var(--line);">
            <p class="card__hint" style="margin-bottom: 6px;">Loop connection (${esc(startStop?.name || 'Start')} → ${esc(endStop?.name || 'End')}):</p>
            <div class="chip-row">
              ${matchingRoutes.map((r) => `
                <span class="course-chip" style="--course: ${esc(r.color || 'var(--green-fill)')}; font-weight: 700;">
                  ${esc(r.name)} (${r.stopsCount} ${r.stopsCount === 1 ? 'stop' : 'stops'})
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>

      <!-- Trip Results Section -->
      <section class="stack">
        ${startStopId && endStopId && startStopId !== endStopId && (best || isConnected) ? `
          <div style="display: flex; justify-content: flex-end; margin-bottom: 2px;">
            <button type="button" class="btn-sketch" data-action="toggle-watch" style="font-size: 14px; padding: 6px 14px; ${isWatching ? 'background: var(--yellow-note); border-color: var(--ink); font-weight: 800;' : ''}">
              ${isWatching ? 'Watching ✓' : '⭐ Watch this trip'}
            </button>
          </div>
        ` : ''}

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

        <!-- Watch This Trip Toggle -->
        ${(best || isConnected) ? `
          <div style="margin-bottom: 2px;">
            <button type="button" class="btn-sketch" data-action="toggle-watch" style="width: 100%; font-size: 15px; font-weight: 800; padding: 10px 14px; background: ${isWatching ? 'var(--yellow-note)' : 'var(--card)'}; border-color: var(--ink); display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 0 var(--ink);">
              ${isWatching ? '⭐ Watching ✓' : '⭐ Watch this trip'}
            </button>
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
              Departs ${esc(startStop?.name || 'Stop')} around <b>${esc(best.eta)}</b> · Reaches ${esc(endStop?.name || 'Destination')} ~<b>${esc(best.arriveEta)}</b>
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

      <!-- Live Campus Routes Summary with actual stop counts -->
      ${feed?.routes && feed.routes.length > 0 ? `
        <section class="stack" style="margin-top: 14px;">
          <p class="hand" style="margin-bottom: 2px;">Campus Routes</p>
          <div class="chip-row">
            ${feed.routes.filter((r) => r.stops && r.stops.length > 0).map((r) => {
              const matched = matchingRoutes.find((m) => String(m.id) === String(r.id));
              const countText = matched ? `${matched.stopsCount} stops` : `${r.stops.length} stops`;
              const highlightStyle = matched ? 'border: 2px solid var(--ink); font-weight: 800; box-shadow: 0 2px 8px rgba(0,0,0,0.15);' : 'cursor: default;';
              return `
                <span class="course-chip" style="--course: ${esc(r.color || 'var(--green-fill)')}; ${highlightStyle}">
                  ${esc(r.name)} (${esc(countText)})
                </span>
              `;
            }).join('')}
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

  currentRoot.addEventListener('click', async (e) => {
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

    // Toggle watch this trip
    if (e.target.closest('[data-action="toggle-watch"]')) {
      const isWatching = Boolean(
        state.watchedTrip &&
        String(state.watchedTrip.fromStopId) === String(state.startStopId) &&
        String(state.watchedTrip.toStopId) === String(state.endStopId)
      );

      if (isWatching) {
        await saveWatchedTrip(null);
        state.watchedTrip = null;
        toast('Stopped watching trip');
      } else {
        const { feed, startStopId, endStopId } = state;
        const stops = feed?.stops || [];
        const startStop = stops.find((s) => String(s.id) === String(startStopId));
        const endStop = stops.find((s) => String(s.id) === String(endStopId));
        const trips = planTrip(feed, { from: startStopId, to: endStopId });
        const { best } = pickTwo(trips);
        const matchingRoute = (feed?.routes || []).find((r) => {
          const rStops = (r.stops || []).map(String);
          return rStops.includes(String(startStopId)) && rStops.includes(String(endStopId));
        });

        const startName = startStop?.name || 'Start';
        const endName = endStop?.name || 'Destination';
        const tripData = {
          routeId: String(best?.route?.id || matchingRoute?.id || ''),
          routeName: String(best?.routeName || matchingRoute?.name || 'Shuttle'),
          fromStopId: String(startStopId),
          fromStopName: startName,
          toStopId: String(endStopId),
          toStopName: endName,
          color: best?.routeColor || matchingRoute?.color || 'var(--green-fill)',
        };
        state.watchedTrip = await saveWatchedTrip(tripData);
        toast(`Watching ${startName} → ${endName} ⭐`);
      }
      renderUI();
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
    let feed = await loadBus();
    if (!feed || !feed.ok) {
      throw new Error(feed?.error || 'Failed to fetch bus routes from server.');
    }

    // Ensure routes have stops populated by calling fetchRoutes if needed
    if (!feed.routes || feed.routes.every((r) => !r.stops || r.stops.length === 0)) {
      const routesWithStops = await fetchRoutes();
      if (routesWithStops.length > 0) {
        feed.routes = routesWithStops;
      }
    }

    state.feed = feed;
    state.error = null;
    state.watchedTrip = await getWatchedTrip();

    // Initialize default selections if not already chosen
    const stops = feed.stops || [];
    if (!state.startStopId || !state.endStopId) {
      if (state.watchedTrip?.fromStopId && state.watchedTrip?.toStopId) {
        state.startStopId = state.watchedTrip.fromStopId;
        state.endStopId = state.watchedTrip.toStopId;
        saveStops(state.startStopId, state.endStopId);
      } else {
        const { fromId, toId } = getSavedStops(stops, feed.routes);
        state.startStopId = fromId;
        state.endStopId = toId;
        saveStops(fromId, toId);
      }
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
