// Tiny sound effects made with Web Audio (no sound files needed) + a buzz where supported.
let enabled = true;
let ctx = null;

export const setSoundEnabled = (on) => { enabled = on !== false; };

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function blip(ac, { from, to, dur, type = 'square', vol = 0.06, at = 0 }) {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  chomp: [{ from: 260, to: 110, dur: 0.07, type: 'sawtooth' }, { from: 240, to: 100, dur: 0.07, type: 'sawtooth', at: 0.11 }],
  ribbit: [{ from: 520, to: 260, dur: 0.08 }, { from: 470, to: 230, dur: 0.1, at: 0.1 }],
  pop: [{ from: 600, to: 900, dur: 0.06, type: 'sine', vol: 0.08 }],
  whoa: [{ from: 280, to: 880, dur: 0.28, type: 'triangle', vol: 0.08 }],
  stamp: [{ from: 180, to: 90, dur: 0.09, type: 'square', vol: 0.07 }],
};

const BUZZ = { chomp: [12, 40, 12], ribbit: 15, pop: 8, whoa: [30, 30, 30], stamp: 20 };

export function play(name) {
  if (!enabled) return;
  try {
    const ac = audio();
    if (ac) for (const b of SOUNDS[name] ?? []) blip(ac, b);
  } catch { /* sound is optional */ }
  try {
    if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(BUZZ[name] ?? 10);
  } catch { /* not supported */ }
}
