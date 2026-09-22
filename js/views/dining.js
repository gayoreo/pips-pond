// Dining tab: what's open now, today's and tomorrow's menus, favorites, diet and allergen filters,
// where to eat in your next free time between classes, and one-tap logging.
import { loadDining, cachedDining, hoursOn, statusAt, mealNow, WEEK } from '../data/dining.js';
import { getProfile, saveProfile } from '../data/db.js';
import { getStudy, dayItems, freeGaps, studyHours, liveTasks, examWindow } from '../data/study.js';
import { cloudEnabled } from '../data/supabase.js';
import { todayKey, addDays, formatHM, ago } from '../core/dates.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { quickLog, openFeedSheet } from './feed.js';

const ALLERGENS = ['Eggs', 'Fish', 'Gluten', 'Milk', 'Mustard', 'Peanut', 'Sesame', 'Shellfish', 'Soy', 'Sulphites', 'Treenuts', 'Wheat'];
const DIETS = { '': 'Anything', vegetarian: 'Vegetarian', vegan: 'Vegan', plant: 'Plant-based' };
const view = { day: 0, open: new Set(), meal: {}, q: '', fetched: false };
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
const prefsOf = (profile) => ({ fav: [], avoid: [], diet: '', ...(profile?.dining ?? {}) });

function itemOk(it, p) {
  if (p.diet === 'vegan' && !it.vegan) return false;
  if (p.diet === 'vegetarian' && !(it.veg || it.vegan)) return false;
  if (p.diet === 'plant' && !(it.plant || it.vegan)) return false;
  if (p.avoid.length) {
    const has = (it.allergens ?? []).map(norm);
    if (p.avoid.some((a) => has.some((h) => h.startsWith(norm(a).slice(0, 4))))) return false;
  }
  return true;
}

const hoursText = (slots) => (!slots.length ? 'Closed'
  : slots.some((s) => s.allDay) ? 'Open all day'
  : slots.map((s) => `${formatHM(s.start)} to ${formatHM(s.end)}`).join(', '));

function statusChip(place, day, isToday) {
  const slots = hoursOn(place, day);
  if (!isToday) return slots.length ? '' : '<span class="dn-chip dn-chip--closed">closed</span>';
  const st = statusAt(place, day, nowHM());
  if (st.open) return `<span class="dn-chip dn-chip--open">${st.allDay ? 'open' : `open until ${esc(formatHM(st.until))}`}</span>`;
  if (st.next) return `<span class="dn-chip">opens ${esc(formatHM(st.next))}</span>`;
  return `<span class="dn-chip dn-chip--closed">closed ${slots.length ? 'for the day' : 'today'}</span>`;
}

const tags = (it) => [it.vegan ? 'vegan' : it.veg ? 'vegetarian' : '', it.plant && !it.vegan ? 'plant-based' : '', it.cal ? `${it.cal} cal` : '']
  .filter(Boolean).map((t) => `<span class="dn-tag">${esc(t)}</span>`).join('');

function menuHTML(place, meals, p) {
  const pick = Math.min(view.meal[place.slug] ?? mealNow(meals, view.day === 0 ? nowHM() : '12:00'), meals.length - 1);
  const meal = meals[pick];
  const stations = meal.stations.map((s) => ({ ...s, items: s.items.filter((it) => itemOk(it, p)) })).filter((s) => s.items.length);
  return `
    <div class="dn-menu">
      ${meals.length > 1 ? `<div class="chip-row">${meals.map((m, i) => `<button type="button" class="fw-day" data-meal="${esc(place.slug)}|${i}" aria-pressed="${i === pick}">${esc(m.meal)}</button>`).join('')}</div>` : ''}
      ${stations.length ? stations.map((s) => `
        <p class="fw-sub">${esc(s.name)}</p>
        <ul class="dn-items">${s.items.map((it) => `<li><span>${esc(it.name)}</span>${tags(it)}</li>`).join('')}</ul>`).join('')
      : '<p class="card__hint">Nothing here matches your filters.</p>'}
    </div>`;
}

function placeCard(place, menus, p, day, isToday) {
  const meals = menus?.[place.slug] ?? [];
  const fav = p.fav.includes(place.slug);
  const open = view.open.has(place.slug);
  const hall = Boolean(place.menuId && meals.length);
  return `
  <li class="card dn-place${fav ? ' is-fav' : ''}">
    <div class="dn-place__head">
      <div class="dn-place__who">
        <b>${esc(place.name)}</b> ${statusChip(place, day, isToday)}
        <span class="muted">${esc(hoursText(hoursOn(place, day)))}</span>
      </div>
      <button type="button" class="btn-plain dn-star" data-fav="${esc(place.slug)}" aria-pressed="${fav}" aria-label="${fav ? 'Unfavorite' : 'Favorite'} ${esc(place.name)}">${fav ? '★' : '☆'}</button>
    </div>
    <div class="row">
      ${meals.length ? `<button type="button" class="btn-plain" data-toggle="${esc(place.slug)}" aria-expanded="${open}">${open ? 'hide menu' : 'menu'}</button>` : ''}
      ${isToday ? `<button type="button" class="btn-plain" data-log="${hall ? 'swipe' : 'points'}" data-name="${esc(place.name)}">+ ${hall ? 'swipe' : 'points'} here</button>` : ''}
      <a class="btn-plain btn-plain--muted" href="${esc(place.url)}" target="_blank" rel="noopener">site</a>
    </div>
    ${open && meals.length ? menuHTML(place, meals, p) : ''}
  </li>`;
}

// On an exam day: eat before it, and here's what's open in time.
function examMealHTML(places) {
  const today = todayKey();
  const s = getStudy();
  const now = nowHM();
  const exam = liveTasks(s)
    .filter((t) => t.type === 'exam' && t.due === today && examWindow(t))
    .map((t) => ({ t, w: examWindow(t) }))
    .filter(({ w }) => w.start > now)
    .sort((a, b) => a.w.start.localeCompare(b.w.start))[0];
  if (!exam) return '';
  const eatBy = `${String(Math.max(0, Number(exam.w.start.slice(0, 2)) - 1)).padStart(2, '0')}:${exam.w.start.slice(3)}`;
  const open = places.filter((pl) => statusAt(pl, today, now > eatBy ? now : eatBy).open);
  return `
    <section class="card dn-gap">
      <p class="fw-sub">📝 ${esc(exam.t.title)} at ${esc(formatHM(exam.w.start))}</p>
      <p>Eat something first. ${open.length ? `Open before then: ${open.slice(0, 4).map((pl) => esc(pl.name)).join(', ')}.` : 'Nothing is open before then, so grab something on the way.'}</p>
    </section>`;
}

// Your next free stretch today (from Study) and which places are open at its start.
function betweenClassesHTML(places, profile) {
  const today = todayKey();
  const s = getStudy();
  if (!s.courses.length) return '';
  const now = nowHM();
  const hours = studyHours(profile);
  const gap = freeGaps(dayItems(s, today), { from: now > hours.from ? now : hours.from, to: hours.to, min: 30 })[0];
  if (!gap) return '';
  const at = gap.start;
  const open = places.filter((pl) => statusAt(pl, today, at).open);
  if (!open.length) return '';
  return `
    <section class="card dn-gap">
      <p class="fw-sub">Free ${at <= now ? 'now' : `at ${esc(formatHM(at))}`} until ${esc(formatHM(gap.end))}</p>
      <p>Open then: ${open.slice(0, 5).map((pl) => esc(pl.name)).join(', ')}${open.length > 5 ? ` and ${open.length - 5} more` : ''}</p>
    </section>`;
}

function searchHTML(data, p, day) {
  const q = view.q.trim().toLowerCase();
  if (q.length < 2) return '';
  const menus = data.menus[day] ?? {};
  const names = Object.fromEntries(data.places.map((pl) => [pl.slug, pl.name]));
  const hits = [];
  for (const [slug, meals] of Object.entries(menus)) {
    for (const m of meals) for (const st of m.stations) for (const it of st.items) {
      if (it.name.toLowerCase().includes(q) && itemOk(it, p)) hits.push({ place: names[slug] ?? slug, meal: m.meal, station: st.name, it });
    }
  }
  if (!hits.length) return '<p class="card__hint">No menu item matches.</p>';
  return `<ul class="dn-items dn-hits">${hits.slice(0, 30).map((h) => `<li><span>${esc(h.it.name)} <span class="muted">${esc(h.place)} · ${esc(h.meal)} · ${esc(h.station)}</span></span>${tags(h.it)}</li>`).join('')}</ul>`;
}

export async function renderDining(root) {
  const profile = await getProfile();
  const p = prefsOf(profile);
  const data = cachedDining() ?? { places: [], menus: {}, updatedAt: '' };
  const today = todayKey();
  const day = view.day === 0 ? today : addDays(today, 1);
  const isToday = view.day === 0;
  const menus = data.menus[day] ?? {};
  const t = nowHM();
  const rank = (pl) => (p.fav.includes(pl.slug) ? 0 : 2) + (isToday && statusAt(pl, day, t).open ? 0 : 1);
  const places = [...data.places].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const filters = [p.diet ? DIETS[p.diet] : '', p.avoid.length ? `no ${p.avoid.join(', ').toLowerCase()}` : ''].filter(Boolean).join(' · ');

  root.innerHTML = `
  <div class="dining stack">
    <header class="study__head">
      <div><p class="eyebrow">Dining</p><h1 class="page-title">${isToday ? 'What’s open' : 'Tomorrow'}</h1></div>
    </header>
    <div class="seg seg--2" role="group" aria-label="Day">
      <button type="button" data-day="0" aria-pressed="${isToday}">Today</button>
      <button type="button" data-day="1" aria-pressed="${!isToday}">Tomorrow</button>
    </div>
    ${isToday ? examMealHTML(data.places) : ''}
    ${isToday ? betweenClassesHTML(data.places, profile) : ''}
    <div class="row">
      <label class="field grow"><span class="field__label">Search ${isToday ? 'today’s' : 'tomorrow’s'} menus</span><input type="search" name="q" autocomplete="off" value="${esc(view.q)}" placeholder="pizza, tofu, waffles"></label>
    </div>
    <div data-hits>${searchHTML(data, p, day)}</div>
    <button type="button" class="btn-plain" data-filters>${filters ? `Filters: ${esc(filters)}` : 'Diet and allergen filters'}</button>
    ${places.length
      ? `<ul class="dn-list">${places.map((pl) => placeCard(pl, menus, p, day, isToday)).join('')}</ul>`
      : `<section class="card"><p class="card__hint">${cloudEnabled ? 'Loading dining halls…' : 'Dining info needs the app’s online setup.'}</p></section>`}
    ${data.updatedAt ? `<p class="card__hint">Menus and hours from UVM Dining, updated ${esc(ago(data.updatedAt))}. Allergen info comes from Sodexo and can be incomplete, so check at the station if it matters.</p>` : ''}
  </div>`;

  const page = root.querySelector('.dining');
  page.querySelector('[name="q"]').addEventListener('input', (e) => {
    view.q = e.target.value;
    page.querySelector('[data-hits]').innerHTML = searchHTML(data, p, day);
  });
  page.addEventListener('click', async (e) => {
    const tt = e.target;
    const d = tt.closest('[data-day]');
    if (d) { view.day = Number(d.dataset.day); return renderDining(root); }
    const tog = tt.closest('[data-toggle]');
    if (tog) { const sl = tog.dataset.toggle; if (view.open.has(sl)) view.open.delete(sl); else view.open.add(sl); return renderDining(root); }
    const meal = tt.closest('[data-meal]');
    if (meal) { const [sl, i] = meal.dataset.meal.split('|'); view.meal[sl] = Number(i); return renderDining(root); }
    const fav = tt.closest('[data-fav]');
    if (fav) {
      const sl = fav.dataset.fav;
      const list = p.fav.includes(sl) ? p.fav.filter((x) => x !== sl) : [...p.fav, sl];
      await saveProfile({ dining: { ...p, fav: list } });
      return renderDining(root);
    }
    const log = tt.closest('[data-log]');
    if (log) {
      if (log.dataset.log === 'swipe') return quickLog({ type: 'swipe', amount: 1, label: `a swipe at ${log.dataset.name}` });
      return openFeedSheet({ type: 'points' });
    }
    if (tt.closest('[data-filters]')) return openFilterSheet(p, () => renderDining(root));
    return undefined;
  });

  // Fetch fresh hours and menus once per visit to the app, then redraw.
  if (!view.fetched && cloudEnabled) {
    view.fetched = true;
    try {
      const fresh = await loadDining(Array.from({ length: WEEK }, (_, i) => addDays(today, i)));
      if (JSON.stringify(fresh) !== JSON.stringify(data) && location.hash === '#/dining') renderDining(root);
    } catch {
      view.fetched = false;
      if (!data.places.length) toast('Couldn’t load dining info. Check your connection.');
    }
  }
}

function openFilterSheet(p, done) {
  const html = `
    <p class="field">Show</p>
    <div class="seg seg--2 dn-diets" role="group" aria-label="Diet">
      ${Object.entries(DIETS).map(([k, label]) => `<button type="button" data-diet="${k}" aria-pressed="${p.diet === k}">${label}</button>`).join('')}
    </div>
    <p class="field">Hide anything with</p>
    <div class="chip-row">${ALLERGENS.map((a) => `<label class="daychip"><input type="checkbox" value="${a}"${p.avoid.includes(a) ? ' checked' : ''}><span>${a}</span></label>`).join('')}</div>
    <p class="card__hint">Saved for next time. Allergen info comes from the dining menus and can be incomplete.</p>
    <button type="button" class="btn-sketch btn-sketch--go btn-sketch--big" data-save>Done</button>`;
  openSheet('Menu filters', html, (sheet, close) => {
    let diet = p.diet;
    sheet.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-diet]');
      if (d) { diet = d.dataset.diet; sheet.querySelectorAll('[data-diet]').forEach((b) => b.setAttribute('aria-pressed', String(b === d))); return; }
      if (!e.target.closest('[data-save]')) return;
      const avoid = [...sheet.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      await saveProfile({ dining: { ...p, diet, avoid } });
      close();
      done();
    });
  });
}
