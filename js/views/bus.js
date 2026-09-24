// Bus view: drill down from active Routes -> Stops -> live Arrivals using Peak Transit API
import { fetchRoutes, fetchStops, fetchPredictions } from '../data/bus.js';
import { esc } from '../ui/dom.js';

const state = {
  step: 'routes',        // 'routes' | 'stops' | 'arrivals'
  routes: null,
  selectedRoute: null,
  stops: null,
  selectedStop: null,
  predictions: null,
  loading: false,
  loadingText: '',
  error: null,
  timer: null,
};

let currentRoot = null;

function renderUI() {
  if (!currentRoot) return;
  const { step, routes, selectedRoute, stops, selectedStop, predictions, loading, loadingText, error } = state;

  let bodyHTML = '';

  if (step === 'routes') {
    bodyHTML = `
      <p class="hand">Select a Route</p>
      ${loading ? `<p class="card__hint">${esc(loadingText || 'Loading active routes…')}</p>` : ''}
      ${error ? `
        <section class="card bus-result">
          <p class="hand">Couldn’t load routes.</p>
          <p class="card__hint">${esc(error)}</p>
          <button type="button" class="btn-sketch btn-sketch--go" data-action="retry-routes">Try again</button>
        </section>
      ` : ''}
      ${!loading && !error && routes && routes.length === 0 ? `
        <section class="card bus-result">
          <p class="hand">No shuttles currently running.</p>
          <p class="card__hint">No active routes found. Shuttles may be off-duty or out of service right now.</p>
          <button type="button" class="btn-sketch" data-action="retry-routes">Refresh</button>
        </section>
      ` : ''}
      ${!loading && !error && routes && routes.length > 0 ? `
        <div class="chip-row">
          ${routes.map((r) => `
            <button type="button" class="course-chip" data-route-id="${esc(r.id)}" style="--course:${esc(r.color || 'var(--green-fill)')}">
              ${esc(r.name)}
            </button>
          `).join('')}
        </div>
      ` : ''}
    `;
  } else if (step === 'stops') {
    bodyHTML = `
      <p class="bus-route">
        Route: <b>${esc(selectedRoute?.name ?? 'Selected Route')}</b>
        <button type="button" class="btn-plain" data-action="change-route">change route</button>
      </p>
      <p class="hand">Select a Stop</p>
      ${loading ? `<p class="card__hint">${esc(loadingText || 'Loading stops…')}</p>` : ''}
      ${error ? `
        <section class="card bus-result">
          <p class="hand">Couldn’t load stops.</p>
          <p class="card__hint">${esc(error)}</p>
          <button type="button" class="btn-sketch btn-sketch--go" data-action="retry-stops">Try again</button>
        </section>
      ` : ''}
      ${!loading && !error && stops && stops.length === 0 ? `
        <section class="card bus-result">
          <p class="hand">No stops found.</p>
          <p class="card__hint">No active stops found for this route.</p>
          <button type="button" class="btn-plain" data-action="change-route">‹ Back to routes</button>
        </section>
      ` : ''}
      ${!loading && !error && stops && stops.length > 0 ? `
        <ul class="stop-list">
          ${stops.map((s) => `
            <li>
              <button type="button" class="stop-pick" data-stop-id="${esc(s.id)}">
                ${esc(s.name)}
              </button>
            </li>
          `).join('')}
        </ul>
        <p><button type="button" class="btn-plain" data-action="change-route">‹ Back to routes</button></p>
      ` : ''}
    `;
  } else if (step === 'arrivals') {
    bodyHTML = `
      <p class="bus-route">
        <b>${esc(selectedRoute?.name ?? 'Route')}</b> → <b>${esc(selectedStop?.name ?? 'Stop')}</b>
        <button type="button" class="btn-plain" data-action="change-stop">change stop</button>
        <button type="button" class="btn-plain" data-action="change-route">all routes</button>
      </p>
      <p class="hand">Live Arrivals</p>
      ${loading ? `<section class="card bus-result"><p class="card__hint">${esc(loadingText || 'Checking live predictions…')}</p></section>` : ''}
      ${error ? `
        <section class="card bus-result">
          <p class="hand">Couldn’t load predictions.</p>
          <p class="card__hint">${esc(error)}</p>
          <button type="button" class="btn-sketch btn-sketch--go" data-action="refresh-predictions">Try again</button>
        </section>
      ` : ''}
      ${!loading && !error && predictions && predictions.length === 0 ? `
        <section class="card bus-result">
          <p class="hand">No shuttles currently running.</p>
          <p class="card__hint">No active arrival predictions found for <b>${esc(selectedStop?.name ?? 'this stop')}</b> on the <b>${esc(selectedRoute?.name ?? 'route')}</b> line right now.</p>
          <div class="row">
            <button type="button" class="btn-sketch" data-action="refresh-predictions">Refresh times</button>
            <button type="button" class="btn-plain" data-action="change-stop">Pick another stop</button>
          </div>
        </section>
      ` : ''}
      ${!loading && !error && predictions && predictions.length > 0 ? `
        ${predictions.map((p, idx) => {
          const minText = p.min <= 0 ? 'Arriving now' : (p.min === 1 ? '1 minute away' : `${p.min} minutes away`);
          return `
            <section class="card bus-result ${idx > 0 ? 'bus-result--backup' : ''}">
              <p class="eyebrow">${idx === 0 ? 'Next Shuttle' : `Option #${idx + 1}`}</p>
              <p class="bus-take" style="--route:${esc(p.color || selectedRoute?.color || 'var(--green-fill)')}">
                <b>${esc(p.routeName || selectedRoute?.name || 'Shuttle')}</b> at <b>${esc(selectedStop?.name || 'Stop')}</b>
              </p>
              <p><b>${esc(minText)}</b>${p.vehicle ? ` · Bus #${esc(p.vehicle)}` : ''}</p>
              ${p.eta ? `<p class="card__hint">Estimated: ${esc(p.eta)}</p>` : ''}
            </section>
          `;
        }).join('')}
        <div class="row">
          <button type="button" class="btn-sketch" data-action="refresh-predictions">Refresh times</button>
          <button type="button" class="btn-plain" data-action="change-stop">Pick another stop</button>
        </div>
      ` : ''}
    `;
  }

  currentRoot.innerHTML = `
    <div class="bus-page stack">
      <div class="sheet__head">
        <a class="btn-plain btn-plain--muted" href="#/pond">‹ pond</a>
        <h1 class="page-title">Catch a bus</h1>
        <button type="button" class="btn-plain" data-action="reset">reset</button>
      </div>
      ${bodyHTML}
    </div>
  `;
}

async function loadInitialRoutes() {
  state.loading = true;
  state.loadingText = 'Loading active routes…';
  state.error = null;
  renderUI();

  try {
    const routes = await fetchRoutes();
    state.routes = routes;
    state.loading = false;
  } catch (err) {
    state.error = 'Failed to load routes from bus service.';
    state.loading = false;
  }
  renderUI();
}

async function selectRoute(routeId) {
  const route = (state.routes || []).find((r) => r.id === String(routeId));
  if (!route) return;

  state.selectedRoute = route;
  state.selectedStop = null;
  state.stops = null;
  state.predictions = null;
  state.step = 'stops';
  state.loading = true;
  state.loadingText = `Loading stops for ${route.name}…`;
  state.error = null;
  renderUI();

  try {
    const stops = await fetchStops(route.id);
    state.stops = stops;
    state.loading = false;
  } catch (err) {
    state.error = `Failed to load stops for ${route.name}.`;
    state.loading = false;
  }
  renderUI();
}

async function selectStop(stopId) {
  const stop = (state.stops || []).find((s) => s.id === String(stopId));
  if (!stop) return;

  state.selectedStop = stop;
  state.predictions = null;
  state.step = 'arrivals';
  state.loading = true;
  state.loadingText = `Checking live arrivals for ${stop.name}…`;
  state.error = null;
  renderUI();

  try {
    const predictions = await fetchPredictions(stop.id);
    state.predictions = predictions;
    state.loading = false;
  } catch (err) {
    state.error = `Failed to load arrival predictions for ${stop.name}.`;
    state.loading = false;
  }
  renderUI();
}

async function refreshPredictions() {
  if (!state.selectedStop) return;
  state.loading = true;
  state.loadingText = `Updating arrivals for ${state.selectedStop.name}…`;
  state.error = null;
  renderUI();

  try {
    const predictions = await fetchPredictions(state.selectedStop.id);
    state.predictions = predictions;
    state.loading = false;
  } catch (err) {
    state.error = 'Could not update live arrivals.';
    state.loading = false;
  }
  renderUI();
}

function setupEvents(root) {
  // Delegate clicks on the bus page
  root.addEventListener('click', (e) => {
    const target = e.target;

    // Route button click (.course-chip)
    const routeChip = target.closest('[data-route-id]');
    if (routeChip) {
      selectRoute(routeChip.dataset.routeId);
      return;
    }

    // Stop button click (.stop-pick)
    const stopPick = target.closest('[data-stop-id]');
    if (stopPick) {
      selectStop(stopPick.dataset.stopId);
      return;
    }

    // Action button clicks
    const actionBtn = target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;

    if (action === 'change-route') {
      state.step = 'routes';
      state.selectedRoute = null;
      state.selectedStop = null;
      state.stops = null;
      state.predictions = null;
      renderUI();
    } else if (action === 'change-stop') {
      state.step = 'stops';
      state.selectedStop = null;
      state.predictions = null;
      renderUI();
    } else if (action === 'retry-routes') {
      loadInitialRoutes();
    } else if (action === 'retry-stops') {
      if (state.selectedRoute) selectRoute(state.selectedRoute.id);
    } else if (action === 'refresh-predictions') {
      refreshPredictions();
    } else if (action === 'reset') {
      openBus();
      loadInitialRoutes();
    }
  });
}

/**
 * Main render function called by the router
 * @param {HTMLElement} root
 */
export async function renderBus(root) {
  currentRoot = root;

  // Clear existing timer if any
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  setupEvents(root);

  if (!state.routes) {
    await loadInitialRoutes();
  } else {
    renderUI();
  }

  // Periodic refresh when on arrivals step
  state.timer = setInterval(() => {
    if (location.hash !== '#/bus') {
      clearInterval(state.timer);
      state.timer = null;
      return;
    }
    if (state.step === 'arrivals' && state.selectedStop && !state.loading) {
      fetchPredictions(state.selectedStop.id).then((preds) => {
        state.predictions = preds;
        renderUI();
      }).catch(() => { /* silent fail on background interval */ });
    }
  }, 15000);
}

/**
 * Reset to initial routes view
 */
export function openBus() {
  state.step = 'routes';
  state.selectedRoute = null;
  state.selectedStop = null;
  state.stops = null;
  state.predictions = null;
  state.error = null;
  location.hash = '#/bus';
}
