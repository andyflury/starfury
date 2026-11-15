import { el, type Screen, svgBox } from './dom.ts';
import { ICONS } from './icons.ts';

/** The framed fact card over the dimmed scene. */
export interface FactCard extends Screen {
  /** Shows or stops the speaking animation. */
  speaking(on: boolean): void;
}

/** Mounts a fact card showing the image at `src` in `overlay`. */
export function showFactCard(overlay: HTMLElement, src: string): FactCard {
  const root = el('div', 'screen fact dim', overlay);
  const card = el('div', 'fact-card', root);
  const frame = el('div', 'fact-frame', card);
  const img = el('img', 'fact-image', frame);
  img.src = src;
  img.alt = '';
  for (const corner of ['tl', 'tr', 'bl', 'br']) el('span', `rivet rivet-${corner}`, card);
  const speaker = svgBox('fact-speaker', ICONS.speaker, card);
  return {
    speaking(on) {
      speaker.classList.toggle('on', on);
    },
    dispose() {
      root.remove();
    },
  };
}
