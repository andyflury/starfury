import type { InputState } from '../types.ts';

/** Throttle change per second while W or S is held. */
const THROTTLE_RATE = 0.7;
/** Stick change per second towards ±1 while an arrow key is held. */
const STICK_RATE = 6;

/** The keyboard and pointer as an input source. */
export interface Keyboard {
  /** Advances the throttle and stick ramps to time `t` (ms). */
  poll(t: number): void;
  readonly state: InputState;
  /** Whether Space, Enter, R or a pointer press arrived since the last call; clears it. */
  takeConfirm(): boolean;
}

const isTextField = (target: EventTarget | null): boolean => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Listens on `window` for the game keys and pointer presses. Inside a text field only Enter counts. */
export function createKeyboard(): Keyboard {
  const held = new Set<string>();
  const state: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: false };
  let pending = false;
  let last: number | undefined;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      pending = true;
      return;
    }
    if (isTextField(e.target)) return;
    held.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Space') {
      state.armed = !state.armed;
      pending = true;
      e.preventDefault();
    } else if (e.code === 'KeyR') pending = true;
    else if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('pointerdown', () => {
    pending = true;
  });

  const ramp = (v: number, neg: string, pos: string, dt: number): number => {
    const target = (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
    if (target === 0) return 0;
    return Math.max(-1, Math.min(1, v + Math.sign(target - v) * Math.min(Math.abs(target - v), STICK_RATE * dt)));
  };

  return {
    state,
    poll(t) {
      const dt = last === undefined ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      const dir = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
      state.throttle = Math.max(0, Math.min(1, state.throttle + dir * THROTTLE_RATE * dt));
      state.stickX = ramp(state.stickX, 'ArrowLeft', 'ArrowRight', dt);
      state.stickY = ramp(state.stickY, 'ArrowDown', 'ArrowUp', dt);
    },
    takeConfirm() {
      const c = pending;
      pending = false;
      return c;
    },
  };
}
