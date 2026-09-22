// (i) info buttons: hover to peek on desktop, click/tap to open, tap anywhere else to close.
import { esc } from './dom.js';

let open = null; // { btn, pop, pinned }

export function infoBtn(text, label = 'More info') {
  return `<button type="button" class="info" data-info="${esc(text)}" aria-label="${esc(label)}" aria-expanded="false">i</button>`;
}

function place(btn, pop) {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const below = r.bottom + 8;
  const top = below + h > window.innerHeight - 8 ? r.top - h - 8 : below;
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${Math.max(8, top) + window.scrollY}px`;
}

function show(btn, pinned) {
  hide();
  const pop = document.createElement('div');
  pop.className = 'info-pop';
  pop.id = 'info-pop';
  pop.setAttribute('role', 'tooltip');
  pop.textContent = btn.dataset.info;
  document.body.append(pop);
  place(btn, pop);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'info-pop');
  open = { btn, pop, pinned };
}

export function hide() {
  if (!open) return;
  open.pop.remove();
  open.btn.setAttribute('aria-expanded', 'false');
  open.btn.removeAttribute('aria-describedby');
  open = null;
}

export function initInfo() {
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.info');
    if (btn) {
      e.preventDefault();
      if (open?.btn === btn && open.pinned) hide();
      else if (open?.btn === btn) open.pinned = true;
      else show(btn, true);
      return;
    }
    if (!e.target.closest('.info-pop')) hide();
  });

  document.addEventListener('mouseover', (e) => {
    if (!hover.matches) return;
    const btn = e.target.closest('.info');
    if (btn && open?.btn !== btn) show(btn, false);
  });

  document.addEventListener('mouseout', (e) => {
    if (!hover.matches || !open || open.pinned) return;
    const btn = e.target.closest('.info');
    if (btn === open.btn && !btn.contains(e.relatedTarget)) hide();
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('hashchange', hide);
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', () => { if (open) place(open.btn, open.pop); }, { passive: true });
}
