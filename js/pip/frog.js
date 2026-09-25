import { esc } from '../ui/dom.js';

const SKIN = { happy: '#7CC96B', eating: '#7CC96B', worried: '#93C46F', sad: '#A3BC93', sleeping: '#78C268', shocked: '#8CCB6E' };
const PUPILS = { happy: [55, 61, 107, 61], worried: [50, 62, 102, 62], sad: [54, 65, 106, 65] };
const DESCRIBE = { happy: 'happy', eating: 'like he is eating', worried: 'worried', sad: 'sad', sleeping: 'asleep', shocked: 'shocked' };

const MOUTH = {
  happy: '<path d="M62 90 Q80 106 98 90" fill="none"/>',
  worried: '<path d="M64 96 Q70 91 76 96 Q82 101 88 96 Q94 91 98 96" fill="none"/>',
  sad: '<path d="M64 100 Q80 88 96 100" fill="none"/>',
  eating: '<ellipse cx="80" cy="95" rx="13" ry="10" fill="#8E3347"/><ellipse cx="80" cy="100" rx="8" ry="4" fill="#F08A9A" stroke="none"/>',
  sleeping: '<circle cx="80" cy="95" r="3.5" fill="none"/>',
  shocked: '<ellipse cx="80" cy="97" rx="8" ry="10" fill="#8E3347"/>',
};

const EXTRA = {
  sad: '<path d="M42 76 C38 84 38 88 42 90 C46 88 46 84 42 76 Z" fill="#7EC8F2" stroke="#3B8DBF" stroke-width="1.5"/>',
  worried: '<path d="M128 38 C124 46 124 50 128 52 C132 50 132 46 128 38 Z" fill="#7EC8F2" stroke="#3B8DBF" stroke-width="1.5"/>',
  eating: `<circle cx="132" cy="84" r="9" fill="#D9A15B"/>
    <circle cx="129" cy="81" r="1.8" fill="#7A4A1E" stroke="none"/>
    <circle cx="135" cy="87" r="1.8" fill="#7A4A1E" stroke="none"/>
    <path d="M146 76 L152 72 M148 88 L155 88" fill="none" stroke-width="2"/>`,
  sleeping: `<g fill="#4F8A61" stroke="none" font-family="Gaegu, cursive" font-weight="700">
    <text x="120" y="42" font-size="16">z</text><text x="132" y="28" font-size="22">Z</text></g>`,
  shocked: `<path d="M24 40 L16 32 M22 52 L12 50 M136 40 L144 32 M138 52 L148 50" fill="none" stroke-width="2.5"/>`,
};

// Seasonal outfits, picked from the date.
export function outfitFor(key) {
  const m = Number(String(key).slice(5, 7));
  if (m === 12) return 'santa';
  if (m <= 2) return 'beanie';
  if (m <= 5) return 'flower';
  if (m <= 8) return 'straw';
  return 'scarf';
}

const OUTFIT = {
  scarf: `<path d="M32 106 Q80 124 128 106 L130 116 Q80 134 30 116 Z" fill="#D9534F"/>
    <path d="M52 113 L50 123 M68 118 L67 127 M92 118 L93 127 M108 113 L110 123" fill="none" stroke="#F6D7A7" stroke-width="3"/>
    <path d="M104 120 L116 144 L104 146 L96 123 Z" fill="#D9534F"/>`,
  santa: `<path d="M32 50 Q34 18 64 22 Q84 26 92 12 Q88 34 76 50 Z" fill="#D9534F"/>
    <path d="M30 50 Q54 42 78 50" fill="none" stroke="#FFFFFF" stroke-width="8"/>
    <circle cx="92" cy="12" r="6" fill="#FFFFFF"/>`,
  beanie: `<path d="M34 50 Q34 22 56 22 Q78 22 78 50 Z" fill="#5B8DD9"/>
    <path d="M32 50 L80 50" fill="none" stroke="#3E6DB5" stroke-width="8"/>
    <circle cx="56" cy="20" r="6" fill="#F6D7A7"/>`,
  flower: `<g stroke-width="2">
    <circle cx="106" cy="30" r="6" fill="#F7A8C4"/><circle cx="115" cy="36" r="6" fill="#F7A8C4"/>
    <circle cx="112" cy="46" r="6" fill="#F7A8C4"/><circle cx="100" cy="46" r="6" fill="#F7A8C4"/>
    <circle cx="97" cy="36" r="6" fill="#F7A8C4"/><circle cx="106" cy="39" r="5" fill="#F2C14E"/></g>`,
  straw: `<path d="M52 38 Q54 14 80 14 Q106 14 108 38 Z" fill="#E8C27A"/>
    <ellipse cx="80" cy="38" rx="54" ry="8" fill="#E8C27A"/>
    <path d="M53 32 L107 32" fill="none" stroke="#C0504D" stroke-width="5"/>`,
};

function eyes(mood) {
  if (mood === 'eating') {
    return '<path d="M44 63 Q54 51 64 63" fill="none"/><path d="M96 63 Q106 51 116 63" fill="none"/>';
  }
  if (mood === 'sleeping') {
    return '<path d="M44 59 Q54 68 64 59" fill="none"/><path d="M96 59 Q106 68 116 59" fill="none"/>';
  }
  if (mood === 'shocked') {
    return `<path d="M40 38 Q54 28 66 36" fill="none"/><path d="M94 36 Q106 28 120 38" fill="none"/>
      <circle cx="54" cy="60" r="14" fill="#fff"/><circle cx="106" cy="60" r="14" fill="#fff"/>
      <circle cx="54" cy="60" r="4" fill="#1C1C1E" stroke="none"/><circle cx="106" cy="60" r="4" fill="#1C1C1E" stroke="none"/>`;
  }
  const [lx, ly, rx, ry] = PUPILS[mood] ?? PUPILS.happy;
  const brows = mood === 'worried' || mood === 'sad'
    ? '<path d="M44 42 L62 36" fill="none"/><path d="M98 36 L116 42" fill="none"/>'
    : '';
  return `${brows}
    <circle cx="54" cy="60" r="12" fill="#fff"/><circle cx="106" cy="60" r="12" fill="#fff"/>
    <circle cx="${lx}" cy="${ly}" r="6" fill="#1C1C1E" stroke="none"/>
    <circle cx="${rx}" cy="${ry}" r="6" fill="#1C1C1E" stroke="none"/>
    <circle cx="${lx + 2}" cy="${ly - 2}" r="2" fill="#fff" stroke="none"/>
    <circle cx="${rx + 2}" cy="${ry - 2}" r="2" fill="#fff" stroke="none"/>`;
}

export function frogSVG(mood = 'happy', name = 'Pip', { outfit = null, companion = 'frog' } = {}) {
  // Sandshrew Companion Override (Lilypad Base + Static Moods + GIFs)
  if (companion === 'sandshrew') {
    let url = 'assets/sandshrew/happy.png'; // Default / Happy

    if (mood === 'eating') {
      url = 'assets/sandshrew/eating.png';
    } else if (mood === 'sleeping') {
      url = 'assets/sandshrew/sleeping.png'; // Curled ball
    } else if (mood === 'sad' || mood === 'worried') {
      url = 'assets/sandshrew/sad.png';
    } else if (mood === 'shocked') {
      url = 'assets/sandshrew/shocked.png';
    } else if (mood === 'jumping') {
      url = 'assets/sandshrew/jump.gif'; // 10 pets easter egg GIF
    } else if (mood === 'dancing') {
      url = 'assets/sandshrew/dance.gif'; // Friend dance ping GIF
    }

    return `
    <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${esc(name)} is ${DESCRIBE[mood] ?? 'happy'}">
      <g filter="url(#wobble)" stroke="#2F5D2B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <!-- Lilypad Base -->
        <path d="M14 134 C14 118 46 112 80 112 C114 112 146 118 146 134 C146 148 114 154 80 154 C46 154 14 148 14 134 Z" fill="#86C29B"/>
        <path d="M80 136 L120 126 M80 136 L42 127" fill="none" stroke="#5E9A73" stroke-width="2"/>
        <ellipse cx="38" cy="128" rx="14" ry="7" fill="#7CC96B"/>
        <ellipse cx="122" cy="128" rx="14" ry="7" fill="#7CC96B"/>
      </g>
      <foreignObject x="10" y="10" width="140" height="140">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
          <img src="${url}" alt="" style="width: 120px; height: 120px; image-rendering: pixelated; image-rendering: crisp-edges; object-fit: contain;" />
        </div>
      </foreignObject>
    </svg>`;
  }

  // Classic Pip the Frog
  const skin = SKIN[mood] ?? SKIN.happy;
  return `
<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${esc(name)} looks ${DESCRIBE[mood] ?? 'happy'}">
  <g filter="url(#wobble)" stroke="#2F5D2B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 134 C14 118 46 112 80 112 C114 112 146 118 146 134 C146 148 114 154 80 154 C46 154 14 148 14 134 Z" fill="#86C29B"/>
    <path d="M80 136 L120 126 M80 136 L42 127" fill="none" stroke="#5E9A73" stroke-width="2"/>
    <ellipse cx="38" cy="128" rx="14" ry="7" fill="${skin}"/>
    <ellipse cx="122" cy="128" rx="14" ry="7" fill="${skin}"/>
    <circle cx="54" cy="62" r="21" fill="${skin}"/>
    <circle cx="106" cy="62" r="21" fill="${skin}"/>
    <ellipse cx="80" cy="102" rx="52" ry="34" fill="${skin}"/>
    <ellipse cx="80" cy="114" rx="30" ry="17" fill="#E6F5C9" stroke="none"/>
    <ellipse cx="60" cy="134" rx="11" ry="6" fill="${skin}"/>
    <ellipse cx="100" cy="134" rx="11" ry="6" fill="${skin}"/>
    <ellipse cx="42" cy="98" rx="8" ry="5" fill="#F29CA3" opacity="0.8" stroke="none"/>
    <ellipse cx="118" cy="98" rx="8" ry="5" fill="#F29CA3" opacity="0.8" stroke="none"/>
    ${eyes(mood)}
    ${MOUTH[mood] ?? MOUTH.happy}
    ${outfit ? OUTFIT[outfit] ?? '' : ''}
    ${EXTRA[mood] ?? ''}
  </g>
</svg>`;
}