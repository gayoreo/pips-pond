import { esc } from '../ui/dom.js';

const SKIN = { happy: '#7CC96B', eating: '#7CC96B', worried: '#93C46F', sad: '#A3BC93', sleeping: '#78C268' };
const PUPILS = { happy: [55, 61, 107, 61], worried: [50, 62, 102, 62], sad: [54, 65, 106, 65] };
const DESCRIBE = { happy: 'happy', eating: 'like he is eating', worried: 'worried', sad: 'sad', sleeping: 'asleep' };

const MOUTH = {
  happy: '<path d="M62 90 Q80 106 98 90" fill="none"/>',
  worried: '<path d="M64 96 Q70 91 76 96 Q82 101 88 96 Q94 91 98 96" fill="none"/>',
  sad: '<path d="M64 100 Q80 88 96 100" fill="none"/>',
  eating: '<ellipse cx="80" cy="95" rx="13" ry="10" fill="#8E3347"/><ellipse cx="80" cy="100" rx="8" ry="4" fill="#F08A9A" stroke="none"/>',
  sleeping: '<circle cx="80" cy="95" r="3.5" fill="none"/>',
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
};

function eyes(mood) {
  if (mood === 'eating') {
    return '<path d="M44 63 Q54 51 64 63" fill="none"/><path d="M96 63 Q106 51 116 63" fill="none"/>';
  }
  if (mood === 'sleeping') {
    return '<path d="M44 59 Q54 68 64 59" fill="none"/><path d="M96 59 Q106 68 116 59" fill="none"/>';
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

export function frogSVG(mood = 'happy', name = 'Pip') {
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
    ${EXTRA[mood] ?? ''}
  </g>
</svg>`;
}