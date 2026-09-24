// Bus page: tap where you're going, Pip works out where you are from your schedule (or asks),
// then says which stop to walk to, where the bus is, whether you'll make it, and a backup that
// leaves within 20 minutes.
import { loadBus, planTrip, pickTwo, nearestStops, walkMinutes, placeKey, DEFAULT_WALK, BACKUP_WINDOW } from '../data/bus.js';
import { getStudy, dayItems } from '../data/study.js';
import { getProfile, saveProfile, newId } from '../data/db.js';
import { todayKey, formatHM } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';

const REFRESH_MS = 15_000;
const bus = { dest: null, origin: null, timer: null, feed: null };

const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const clockIn = (min) => { const d = new Date(Date.now() + min * 60000); return formatHM(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); };
const busPrefs = (profile) => ({ places: {}, saved: [], ...(profile?.bus ?? {}) });

async function saveBusPrefs(patch) {
  const p = await getProfile();
  await saveProfile({ bus: { ...busPrefs(p), ...patch } });
}

// ---------- where am I / where am I going ----------
// Today's schedule items that have a room or building on them.
function placedItems() {
  return dayItems(getStudy(), todayKey()).filter((i) => i.place && !i.cancelled && !i.holiday && !i.soft);
}

// In class now, or out of one in the last 15 minutes. Otherwise we don't know.
function whereAmI() {
  const now = toMin(nowHM());
  const endOf = (i) => (i.end ? toMin(i.end) : toMin(i.start) + 60);
  const items = placedItems();
  const cur = items.find((i) => toMin(i.start) <= now && now < endOf(i));
  if (cur) return { label: cur.place, why: `in ${cur.title}` };
  const just = items.filter((i) => endOf(i) <= now && now - endOf(i) <= 15).pop();
  if (just) return { label: just.place, why: `just out of ${just.title}` };
  return null;
}

// Where you might be headed: the rest of today's classes first.
function upcomingPlaces() {
  const now = toMin(nowHM());
  return placedItems().filter((i) => toMin(i.start) >= now - 5)
    .map((i) => ({ label: i.place, detail: `${i.title} · ${formatHM(i.start)}` }));
}

// A building or saved place as the stops it's linked to. null if it isn't linked yet.
function linkedStops(prefs, label) {
  const saved = prefs.saved.find((s) => s.name === label);
  if (saved) return [{ stopId: saved.stopId, walk: saved.walk ?? DEFAULT_WALK }];
  const link = prefs.places[placeKey(label)];
  return link ? [{ stopId: link.stopId, walk: link.walk ?? DEFAULT_WALK }] : null;
}

// ---------- sheets ----------
function openStopPicker(title, intro, feed, onPick) {
  const stops = [...(feed.stops ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (!stops.length) { toast('The bus stops load once live bus data is connected.'); return; }
  const list = (q) => stops.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40)
    .map((s) => `<li><button type="button" class="stop-pick" data-stop="${esc(s.id)}">${esc(s.name)}</button></li>`).join('')
    || '<li class="card__hint">No stop by that name.</li>';
  const html = `
    ${intro ? `<p class="card__hint">${intro}</p>` : ''}
    <label class="field">Search stops<input type="search" name="q" autocomplete="off"></label>
    <label class="field">Walk from there to the stop
      <select name="walk">${[1, 2, 4, 6, 8, 10].map((n) => `<option value="${n}"${n === DEFAULT_WALK ? ' selected' : ''}>${n} min</option>`).join('')}</select>
    </label>
    <ul class="stop-list" data-list>${list('')}</ul>`;
  openSheet(title, html, (sheet, close) => {
    const q = sheet.querySelector('[name="q"]');
    q.addEventListener('input', () => { sheet.querySelector('[data-list]').innerHTML = list(q.value); });
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-stop]');
      if (!b) return;
      close();
      onPick(b.dataset.stop, Number(sheet.querySelector('[name="walk"]').value) || DEFAULT_WALK);
    });
  });
}

// Links a building (like "Innov") to its closest stop, once. Asked the first time it comes up.
function linkPlace(label, feed, then) {
  openStopPicker(`Closest stop to ${label}`, `Which stop do you use for <b>${esc(label)}</b>? You only pick this once.`, feed, async (stopId, walk) => {
    const p = busPrefs(await getProfile());
    await saveBusPrefs({ places: { ...p.places, [placeKey(label)]: { stopId, walk, name: label } } });
    then([{ stopId, walk }]);
  });
}

function useMyLocation(feed, then) {
  if (!navigator.geolocation) { toast('This device can’t share its location.'); return; }
  if (!(feed.stops ?? []).length) { toast('The bus stops load once live bus data is connected.'); return; }
  toast('Finding you…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const near = nearestStops(feed.stops, { lat: pos.coords.latitude, lon: pos.coords.longitude }, 3);
    if (!near.length) { toast('No stops found near you.'); return; }
    then({ label: 'where you are', from: near.map((n) => ({ stopId: n.stop.id, walk: walkMinutes(n.m) })) });
  }, () => toast('Couldn’t get your location. Pick a place instead.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

// "Where are you now?" when the schedule doesn't say.
async function askOrigin(feed, root) {
  const prefs = busPrefs(await getProfile());
  const today = [...new Set(placedItems().map((i) => i.place))];
  const html = `
    <p class="card__hint">Your schedule doesn’t say where you are right now.</p>
    <button type="button" class="btn-sketch btn-sketch--go" data-loc>Use my location</button>
    ${today.length ? `<p class="fw-sub">Today’s places</p><ul class="stop-list">${today.map((p) => `<li><button type="button" class="stop-pick" data-place="${esc(p)}">${esc(p)}</button></li>`).join('')}</ul>` : ''}
    ${prefs.saved.length ? `<p class="fw-sub">Saved places</p><ul class="stop-list">${prefs.saved.map((s) => `<li><button type="button" class="stop-pick" data-place="${esc(s.name)}">${esc(s.name)}</button></li>`).join('')}</ul>` : ''}
    <button type="button" class="btn-plain" data-stop-any>I’m at a bus stop…</button>`;
  openSheet('Where are you?', html, (sheet, close) => {
    sheet.addEventListener('click', (e) => {
      const done = (origin) => { bus.origin = origin; renderBus(root); };
      if (e.target.closest('[data-loc]')) { close(); useMyLocation(feed, done); return; }
      if (e.target.closest('[data-stop-any]')) {
        close();
        openStopPicker('Which stop?', '', feed, (stopId) => done({ label: feed.stops.find((s) => s.id === stopId)?.name ?? 'that stop', from: [{ stopId, walk: 0 }] }));
        return;
      }
      const p = e.target.closest('[data-place]');
      if (!p) return;
      close();
      const label = p.dataset.place;
      const stops = linkedStops(prefs, label);
      if (stops) done({ label, from: stops });
      else linkPlace(label, feed, (from) => done({ label, from }));
    });
  });
}

function openSavePlace(feed, root) {
  const html = `
    <label class="field">Name<input name="name" maxlength="30" autocomplete="off" placeholder="Home, Davis Center, the gym"></label>
    <button type="button" class="btn-sketch btn-sketch--go" data-next>Pick its stop</button>`;
  openSheet('Save a place', html, (sheet, close) => {
    sheet.querySelector('[data-next]').addEventListener('click', () => {
      const name = sheet.querySelector('[name="name"]').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      close();
      openStopPicker(`Stop for ${name}`, '', feed, async (stopId, walk) => {
        const p = busPrefs(await getProfile());
        await saveBusPrefs({ saved: [...p.saved.filter((s) => s.name !== name), { id: newId(), name, stopId, walk }] });
        toast(`Saved ${name}.`);
        renderBus(root);
      });
    });
  });
}

async function openManage(feed, root) {
  const prefs = busPrefs(await getProfile());
  const stopName = (id) => feed.stops.find((s) => s.id === id)?.name ?? 'a stop';
  const links = Object.entries(prefs.places);
  const html = `
    <p class="fw-sub">Buildings</p>
    ${links.length ? `<ul class="plain-list">${links.map(([k, v]) => `<li class="row"><span>${esc(v.name || k)} → ${esc(stopName(v.stopId))} · ${v.walk} min walk</span><button type="button" class="btn-plain btn-plain--danger" data-rm-link="${esc(k)}">✕</button></li>`).join('')}</ul>` : '<p class="card__hint">None yet. They get added the first time a class building comes up.</p>'}
    <p class="fw-sub">Saved places</p>
    ${prefs.saved.length ? `<ul class="plain-list">${prefs.saved.map((s) => `<li class="row"><span>${esc(s.name)} → ${esc(stopName(s.stopId))} · ${s.walk} min walk</span><button type="button" class="btn-plain btn-plain--danger" data-rm-saved="${esc(s.id)}">✕</button></li>`).join('')}</ul>` : '<p class="card__hint">None yet.</p>'}`;
  openSheet('Your bus places', html, (sheet, close) => {
    sheet.addEventListener('click', async (e) => {
      const l = e.target.closest('[data-rm-link]');
      const s = e.target.closest('[data-rm-saved]');
      if (!l && !s) return;
      const p = busPrefs(await getProfile());
      if (l) { const places = { ...p.places }; delete places[l.dataset.rmLink]; await saveBusPrefs({ places }); }
      if (s) await saveBusPrefs({ saved: p.saved.filter((x) => x.id !== s.dataset.rmSaved) });
      close();
      renderBus(root);
    });
  });
}

// ---------- the answer ----------
function tripText(o, destLabel) {
  const leave = o.leaveIn <= 0 ? 'Leave now' : o.leaveIn === 1 ? 'Leave in about a minute' : `Leave in ${o.leaveIn} min`;
  const where = o.busNear
    ? (o.stopsAway === 0 ? `The bus is at ${esc(o.busNear)}.` : `The bus is near ${esc(o.busNear)}, ${o.stopsAway} ${o.stopsAway === 1 ? 'stop' : 'stops'} before yours.`)
    : '';
  return `
    <p class="bus-take" style="--route:${esc(o.color || 'var(--tape)')}"><b>${esc(o.routeName)}</b> from <b>${esc(o.boardStop)}</b></p>
    <p>${where} It reaches ${esc(o.boardStop)} in about ${o.busIn} min${o.walk ? `, and the walk there is ${o.walk} min` : ''}. <b>${leave}.</b></p>
    <p class="card__hint">Get off at ${esc(o.alightStop)}. You’ll get to ${esc(destLabel)} around ${esc(clockIn(o.arriveIn + (bus.dest?.walkAfter ?? 0)))}.</p>`;
}

function resultHTML(feed) {
  const { dest, origin } = bus;
  if (!feed.ok) {
    return `<section class="card bus-result"><p class="hand">${feed.reason === 'error' ? 'Couldn’t reach the bus map just now.' : 'Live bus times aren’t hooked up yet.'}</p>
      <p class="card__hint">${feed.reason === 'error' ? 'Try refresh in a moment.' : 'Once they are, this is where Pip tells you which stop to go to, where the bus is and whether you’ll make it.'}</p></section>`;
  }
  const plan = planTrip(feed, { from: origin.from, to: dest.stops.map((s) => s.stopId) });
  const { best, backup } = pickTwo(plan);
  if (!best) {
    const why = plan.missed ? `The next one leaves ${esc(plan.missed.boardStop)} in ${plan.missed.busIn} min, but the walk is ${plan.missed.walk} min.` : 'No route here connects those stops right now.';
    return `<section class="card bus-result"><p class="hand">No bus you can catch.</p><p class="card__hint">${why}</p></section>`;
  }
  const missedNote = plan.missed && plan.missed.busIn < best.busIn
    ? `<p class="card__hint">You’d just miss the ${esc(plan.missed.routeName)} at ${esc(plan.missed.boardStop)} in ${plan.missed.busIn} min.</p>` : '';
  return `
    <section class="card bus-result">
      <p class="eyebrow">Best way</p>
      ${tripText(best, dest.label)}
      ${missedNote}
    </section>
    <section class="card bus-result bus-result--backup">
      <p class="eyebrow">Second option</p>
      ${backup ? tripText(backup, dest.label) : `<p class="card__hint">Nothing else leaves in the next ${BACKUP_WINDOW} minutes.</p>`}
    </section>`;
}

// ---------- the page ----------
export async function renderBus(root) {
  const feed = await loadBus();
  bus.feed = feed;
  const prefs = busPrefs(await getProfile());
  if (bus.timer) { clearInterval(bus.timer); bus.timer = null; }

  const ready = bus.dest && bus.origin;
  const upcoming = upcomingPlaces();
  root.innerHTML = `
  <div class="bus-page stack">
    <div class="sheet__head">
      <a class="btn-plain btn-plain--muted" href="#/pond">back</a>
      <h1 class="page-title">Catch a bus</h1>
      <button type="button" class="btn-plain" data-manage>places</button>
    </div>
    ${ready ? `
      <p class="bus-route"><b>${esc(bus.origin.label)}</b> → <b>${esc(bus.dest.label)}</b>
        <button type="button" class="btn-plain" data-change-from>change start</button>
        <button type="button" class="btn-plain" data-change-to>change stop</button></p>
      ${resultHTML(feed)}
      <p class="card__hint">${feed.ok ? `Updated ${new Date(feed.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}. Refreshes every 15 seconds.` : ''}
        <button type="button" class="btn-plain" data-refresh>refresh</button></p>` : `
      <p class="hand">Where to?</p>
      ${upcoming.length ? `<p class="fw-sub">Your next classes</p><ul class="stop-list">${upcoming.map((u) => `<li><button type="button" class="stop-pick" data-to-place="${esc(u.label)}">${esc(u.label)} <span class="muted">${esc(u.detail)}</span></button></li>`).join('')}</ul>` : ''}
      ${prefs.saved.length ? `<p class="fw-sub">Saved places</p><ul class="stop-list">${prefs.saved.map((s) => `<li><button type="button" class="stop-pick" data-to-place="${esc(s.name)}">${esc(s.name)}</button></li>`).join('')}</ul>` : ''}
      <div class="row">
        <button type="button" class="btn-plain" data-to-stop>a bus stop…</button>
        <button type="button" class="btn-plain" data-save-place>+ save a place</button>
      </div>
      ${feed.ok ? '' : `<p class="card__hint">${feed.reason === 'error' ? 'Couldn’t reach the bus map just now.' : 'Live bus times aren’t hooked up yet, so stops and trips will show up once they are.'}</p>`}`}
  </div>`;

  const page = root.querySelector('.bus-page');
  const go = () => {
    // Work out where you are, or ask.
    if (!bus.origin) {
      const here = whereAmI();
      if (here) {
        const stops = linkedStops(prefs, here.label);
        if (stops) { bus.origin = { label: here.label, from: stops }; renderBus(root); return; }
        linkPlace(here.label, feed, (from) => { bus.origin = { label: here.label, from }; renderBus(root); });
        return;
      }
      askOrigin(feed, root);
      return;
    }
    renderBus(root);
  };
  const setDestPlace = (label) => {
    const stops = linkedStops(prefs, label);
    if (stops) { bus.dest = { label, stops, walkAfter: stops[0].walk }; go(); return; }
    linkPlace(label, feed, (s) => { bus.dest = { label, stops: s, walkAfter: s[0].walk }; go(); });
  };

  page.addEventListener('click', (e) => {
    const t = e.target;
    const place = t.closest('[data-to-place]');
    if (place) return setDestPlace(place.dataset.toPlace);
    if (t.closest('[data-to-stop]')) {
      return openStopPicker('Going to which stop?', '', feed, (stopId) => {
        bus.dest = { label: feed.stops.find((s) => s.id === stopId)?.name ?? 'that stop', stops: [{ stopId, walk: 0 }] };
        go();
      });
    }
    if (t.closest('[data-save-place]')) return openSavePlace(feed, root);
    if (t.closest('[data-manage]')) return openManage(feed, root);
    if (t.closest('[data-change-from]')) { bus.origin = null; return askOrigin(feed, root); }
    if (t.closest('[data-change-to]')) { bus.dest = null; return renderBus(root); }
    if (t.closest('[data-refresh]')) return renderBus(root);
    return undefined;
  });

  if (ready && feed.ok) {
    bus.timer = setInterval(() => {
      if (location.hash !== '#/bus') { clearInterval(bus.timer); bus.timer = null; return; }
      renderBus(root);
    }, REFRESH_MS);
  }
}

// Start fresh each time the page is opened from somewhere else.
export function openBus() {
  bus.dest = null;
  bus.origin = null;
  location.hash = '#/bus';
}