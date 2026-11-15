import type { RawSnapshot } from './mapping.ts';

/** Reads the pad in use: the connected pad whose id is `preferredId`, otherwise the first connected pad; undefined when none is. */
export function readPad(preferredId: string | undefined): RawSnapshot | undefined {
  const pads = navigator.getGamepads().filter((p): p is Gamepad => p !== null && p.connected);
  const pad = pads.find((p) => p.id === preferredId) ?? pads[0];
  if (!pad) return undefined;
  return { id: pad.id, axes: [...pad.axes], buttons: pad.buttons.map((b) => b.pressed) };
}
