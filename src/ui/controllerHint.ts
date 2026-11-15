import type { HintIcon } from '../types.ts';
import { svgBox } from './dom.ts';

const MARKUP = `<svg viewBox="0 -58 300 228" aria-hidden="true">
  <path class="ch-curve ch-curve-on" d="M52 -18 Q81 -50 110 -20 M107.8 -33.8 L110 -20 L96.3 -22.7"/>
  <path class="ch-curve ch-curve-off" d="M110 -18 Q81 -50 52 -20 M54.2 -33.8 L52 -20 L65.7 -22.7"/>
  <path class="ch-body" d="M62 44 Q62 32 76 32 H224 Q238 32 238 44 L252 146 Q254 164 236 164 H64 Q46 164 48 146 Z"/>
  <rect class="ch-switch-base" x="70" y="22" width="22" height="16" rx="4"/>
  <rect class="ch-switch-base ch-dim" x="208" y="22" width="22" height="16" rx="4"/>
  <g class="ch-lever"><line x1="81" y1="30" x2="81" y2="-10"/><circle cx="81" cy="-10" r="9"/></g>
  <g class="ch-lever-dim"><line x1="219" y1="30" x2="219" y2="4"/><circle cx="219" cy="4" r="6"/></g>
  <circle class="ch-gimbal ch-gimbal-left" cx="100" cy="104" r="34"/>
  <circle class="ch-gimbal ch-gimbal-right" cx="200" cy="104" r="34"/>
  <g class="ch-knob ch-knob-left"><circle cx="100" cy="104" r="14"/><circle class="ch-knob-dot" cx="100" cy="104" r="5"/></g>
  <g class="ch-knob ch-knob-right"><circle cx="200" cy="104" r="14"/><circle class="ch-knob-dot" cx="200" cy="104" r="5"/></g>
  <g class="ch-arrow ch-arrow-up"><path d="M22 146 V64 M6 82 L22 64 L38 82"/></g>
  <g class="ch-arrow ch-arrow-down"><path d="M22 60 V142 M6 124 L22 142 L38 124"/></g>
</svg>`;

/** An animated drawing of the transmitter that shows which stick or switch to move. */
export interface ControllerHint {
  readonly element: HTMLElement;
  /** Shows the motion for `icon`. */
  set(icon: HintIcon): void;
}

/** Creates a controller hint inside `parent`. */
export function createControllerHint(parent: HTMLElement, icon: HintIcon): ControllerHint {
  const element = svgBox('controller-hint', MARKUP, parent);
  const set = (next: HintIcon): void => {
    element.dataset.icon = next;
  };
  set(icon);
  return { element, set };
}
