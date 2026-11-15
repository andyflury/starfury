import { createControllerHint } from './controllerHint.ts';
import { el, type Screen, svgBox } from './dom.ts';
import { ICONS } from './icons.ts';

/** Mounts the retry screen, a big retry arrow over the flip-the-switch hint, in `overlay`. */
export function showRetry(overlay: HTMLElement): Screen {
  const root = el('div', 'screen retry dim', overlay);
  svgBox('retry-arrow', ICONS.retry, root);
  const hint = el('div', 'panel retry-hint', root);
  createControllerHint(hint, 'flip');
  return {
    dispose() {
      root.remove();
    },
  };
}
