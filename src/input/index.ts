import type { Input, InputState } from '../types.ts';
import { readPad } from './gamepad.ts';
import { createKeyboard } from './keyboard.ts';
import { applyMapping, loadMapping, saveMapping, type Mapping, type RawSnapshot } from './mapping.ts';

/** The game's input plus what the setup wizard needs. */
export interface GameInput extends Input {
  /** The pad in use at the last poll; undefined when none is connected. */
  readonly raw: RawSnapshot | undefined;
  /** The stored mapping. */
  readonly mapping: Mapping | undefined;
  /** Stores the mapping, or clears it for undefined. */
  setMapping(mapping: Mapping | undefined): void;
}

/** Creates the input over the keyboard, the pointer and the controller with the stored mapping. */
export function createInput(): GameInput {
  const keyboard = createKeyboard();
  let mapping = loadMapping();
  let raw: RawSnapshot | undefined;
  let padState: InputState | undefined;
  let padArmed: boolean | undefined;
  let confirm = false;

  return {
    poll() {
      keyboard.poll(performance.now());
      raw = readPad(mapping?.padId);
      padState = mapping && raw ? applyMapping(mapping, raw) : undefined;
      const armFlipped = padState !== undefined && padArmed !== undefined && padState.armed !== padArmed;
      padArmed = padState?.armed;
      confirm = keyboard.takeConfirm() || armFlipped;
    },
    get state() {
      return padState ?? keyboard.state;
    },
    get confirm() {
      return confirm;
    },
    flush() {
      keyboard.takeConfirm();
      confirm = false;
    },
    get source() {
      return padState ? 'gamepad' : 'keyboard';
    },
    get mapped() {
      return mapping !== undefined;
    },
    get raw() {
      return raw;
    },
    get mapping() {
      return mapping;
    },
    setMapping(m) {
      mapping = m;
      saveMapping(m);
      padState = padArmed = undefined;
    },
  };
}
