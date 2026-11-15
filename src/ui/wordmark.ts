/** Centreline strokes of the StarFury lettering, each letter in a 64 × 80 cell, drawn with a 16-unit round stroke. */
export const LETTERS: Readonly<Record<string, string>> = {
  S: 'M50 16 C42 6 12 4 12 22 C12 40 50 36 50 56 C50 76 18 78 9 64',
  T: 'M8 8 H56 M32 8 V72',
  A: 'M8 72 L32 8 L56 72 M17 50 H47',
  R: 'M10 72 V8 H34 C58 8 58 42 34 42 H10 M32 42 L54 72',
  F: 'M52 8 H10 V72 M10 40 H44',
  U: 'M10 8 V48 C10 80 54 80 54 48 V8',
  Y: 'M8 8 L32 40 L56 8 M32 40 V72',
};

/** The game's name as lettered. */
export const WORD = 'STARFURY';

/** Horizontal advance of one letter cell. */
export const ADVANCE = 66;

const WIDTH = ADVANCE * WORD.length;

/** SVG markup of the StarFury wordmark: layered glowing strokes, a slant and a flame swoosh with a rocket. */
export function wordmarkSvg(): string {
  const letters = [...WORD].map((c, i) => `<path transform="translate(${i * ADVANCE} 0)" d="${LETTERS[c] ?? ''}"/>`).join('');
  const swoosh = `M-10 104 C140 92 340 92 ${WIDTH - 40} 100`;
  return `<svg viewBox="-40 -24 ${WIDTH + 80} 150" class="wordmark-svg" aria-hidden="true">
  <defs>
    <linearGradient id="wm-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6c2"/><stop offset="0.45" stop-color="#ffc21f"/><stop offset="1" stop-color="#ff4a12"/>
    </linearGradient>
    <linearGradient id="wm-swoosh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff4a12" stop-opacity="0"/><stop offset="0.6" stop-color="#ff9a1f"/><stop offset="1" stop-color="#fff6c2"/>
    </linearGradient>
  </defs>
  <g transform="skewX(-12)">
    <path d="${swoosh}" fill="none" stroke="url(#wm-swoosh)" stroke-width="12" stroke-linecap="round"/>
    <g transform="translate(${WIDTH - 30} 98) rotate(-8)">
      <path d="M0 -9 L30 -6 Q44 0 30 6 L0 9 Z" fill="#e8eef7" stroke="#0a1230" stroke-width="4" stroke-linejoin="round"/>
      <path d="M4 -9 L-6 -18 L-2 -8 Z M4 9 L-6 18 L-2 8 Z" fill="#3ee6ff" stroke="#0a1230" stroke-width="3" stroke-linejoin="round"/>
    </g>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <g stroke="#3ee6ff" stroke-width="34" opacity="0.35" class="wm-glow">${letters}</g>
      <g stroke="#0a1230" stroke-width="30">${letters}</g>
      <g stroke="url(#wm-fill)" stroke-width="18">${letters}</g>
      <g stroke="#ffffff" stroke-width="4" opacity="0.7" transform="translate(-2 -4)">${letters}</g>
    </g>
  </g>
</svg>`;
}
