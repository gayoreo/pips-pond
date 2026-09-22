// A bottom sheet (a centered panel on desktop). wire(sheet, close) hooks up its contents.
import { esc } from './dom.js';

export function openSheet(title, html, wire) {
  const opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `
    <div class="sheet study-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <span class="sheet__grab" aria-hidden="true"></span>
      <div class="sheet__head">
        <button type="button" class="btn-plain btn-plain--muted" data-close>close</button>
        <h2 class="eyebrow">${esc(title)}</h2>
        <span class="spacer"></span>
      </div>
      <div class="study-sheet__body">${html}</div>
    </div>`;
  const sheet = back.querySelector('.sheet');
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    back.remove();
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    opener?.focus?.();
  }
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.body.append(back);
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  sheet.focus();
  wire(sheet, close);
  return close;
}