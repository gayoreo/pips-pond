// A small chip at the top of the screen showing sync / offline state.
// Only used when accounts are on. Stays out of the way: it only appears when
// something's worth saying (offline, actively syncing, or a sync problem).
import { SYNC_EVENT, syncState } from '../data/sync.js';
import { cloudEnabled, userNow } from '../data/supabase.js';

let chip = null;
let hideTimer = null;
let showSyncTimer = null;

function el() {
  if (chip) return chip;
  chip = document.createElement('div');
  chip.className = 'netchip';
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  chip.hidden = true;
  document.body.append(chip);
  return chip;
}

function paint(kind, label) {
  const c = el();
  clearTimeout(hideTimer);
  c.className = `netchip is-${kind} is-shown`;
  c.innerHTML = kind === 'syncing'
    ? `<span class="netchip__spin" aria-hidden="true"></span>${label}`
    : label;
  c.hidden = false;
}

function hide() {
  if (!chip) return;
  chip.classList.remove('is-shown');
  hideTimer = setTimeout(() => { if (chip) chip.hidden = true; }, 300);
}

function apply() {
  clearTimeout(showSyncTimer);
  const signedIn = Boolean(userNow());
  if (!navigator.onLine && signedIn) return paint('offline', 'Offline. Changes are saved here.');
  switch (syncState.status) {
    case 'offline': return signedIn ? paint('offline', 'Offline. Changes are saved here.') : hide();
    case 'error': return paint('error', 'Sync will retry');
    case 'syncing':
      // Don't flash for quick syncs — only show if it takes a moment.
      showSyncTimer = setTimeout(() => { if (syncState.status === 'syncing') paint('syncing', 'Syncing…'); }, 600);
      return;
    case 'synced':
      if (chip && chip.classList.contains('is-shown')) { paint('synced', 'Synced ✓'); hideTimer = setTimeout(hide, 1400); }
      return;
    default: return hide();
  }
}

export function initStatus() {
  if (!cloudEnabled) return;
  window.addEventListener(SYNC_EVENT, apply);
  window.addEventListener('online', apply);
  window.addEventListener('offline', apply);
  apply();
}
