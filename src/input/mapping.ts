import type { InputState } from '../types.ts';
import { load, save } from '../storage.ts';

/** One reading of a controller: its raw axes and buttons as the Gamepad API reports them. */
export interface RawSnapshot {
  id: string;
  axes: number[];
  buttons: boolean[];
}

/** The throttle axis and its raw values at the bottom and at the top. */
export interface ThrottleMapping {
  axis: number;
  bottom: number;
  top: number;
}

/** A centering stick axis and its raw values at rest, at the negative end (left / down) and at the positive end (right / up). */
export interface StickMapping {
  axis: number;
  rest: number;
  negative: number;
  positive: number;
}

/** The Arm switch: an axis with its raw value when armed, or a button with the pressed state that means armed. */
export type ArmMapping = { kind: 'axis'; axis: number; armed: number } | { kind: 'button'; button: number; pressed: boolean };

/** Everything the setup wizard detected for one controller. */
export interface Mapping {
  padId: string;
  throttle: ThrottleMapping;
  stickX: StickMapping;
  stickY: StickMapping;
  arm: ArmMapping;
}

/** Movement under this many raw units never makes an axis a candidate. */
export const JITTER = 0.3;
/** Raw range an axis step needs before it can complete. */
export const MIN_RANGE = 1.2;
/** Fraction of the stick travel around rest that reads as 0. */
export const DEAD_ZONE = 0.05;
/** An Arm axis reads as armed while within this of its armed value. */
export const ARM_TOLERANCE = 0.4;

/** A hold counts while the axis stays within this of where the hold began. */
const STEADY = 0.1;
const THROTTLE_HOLD_MS = 400;
/** The throttle's travel must span at least this before its top can be taken. */
const TOP_TRAVEL = 0.5;
const STICK_HOLD_MS = 300;
/** A stick's rest must lie within this of the middle of its range. */
const REST_CENTRE = 0.25;
const ARM_JUMP = 0.5;
const ARM_HOLD_MS = 250;
const ARM_STEADY = 0.2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Maps a raw snapshot to player input; a missing axis reads as its bottom or rest value. */
export function applyMapping(mapping: Mapping, raw: RawSnapshot): InputState {
  const { throttle, stickX, stickY, arm } = mapping;
  const t = raw.axes[throttle.axis] ?? throttle.bottom;
  return {
    throttle: clamp((t - throttle.bottom) / (throttle.top - throttle.bottom), 0, 1),
    stickX: stickValue(stickX, raw.axes[stickX.axis] ?? stickX.rest),
    stickY: stickValue(stickY, raw.axes[stickY.axis] ?? stickY.rest),
    armed: arm.kind === 'axis' ? Math.abs((raw.axes[arm.axis] ?? Infinity) - arm.armed) <= ARM_TOLERANCE : (raw.buttons[arm.button] ?? false) === arm.pressed,
  };
}

function stickValue(m: StickMapping, raw: number): number {
  const d = raw - m.rest;
  const u = d * (m.positive - m.rest) > 0 ? d / (m.positive - m.rest) : -d / (m.negative - m.rest);
  const a = Math.abs(u);
  if (a < DEAD_ZONE) return 0;
  return Math.sign(u) * Math.min(1, (a - DEAD_ZONE) / (1 - DEAD_ZONE));
}

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isStick(v: unknown): v is StickMapping {
  return isObj(v) && isIndex(v.axis) && isNum(v.rest) && isNum(v.negative) && isNum(v.positive) && v.negative !== v.rest && v.positive !== v.rest;
}

/** Whether `v` has the shape of a usable `Mapping`. */
export function isMapping(v: unknown): v is Mapping {
  if (!isObj(v) || typeof v.padId !== 'string') return false;
  const { throttle: t, arm: a } = v;
  if (!isObj(t) || !isIndex(t.axis) || !isNum(t.bottom) || !isNum(t.top) || t.bottom === t.top) return false;
  if (!isStick(v.stickX) || !isStick(v.stickY) || !isObj(a)) return false;
  return (a.kind === 'axis' && isIndex(a.axis) && isNum(a.armed)) || (a.kind === 'button' && isIndex(a.button) && typeof a.pressed === 'boolean');
}

/** The stored mapping; undefined when absent or malformed. */
export function loadMapping(): Mapping | undefined {
  const v = load('mapping');
  return isMapping(v) ? v : undefined;
}

/** Stores the mapping, or removes it for undefined. */
export function saveMapping(mapping: Mapping | undefined): void {
  save('mapping', mapping);
}

/** The axis a detection step is currently following; `display` is −1…+1 with +1 in the prompt's direction. */
export interface AxisCandidate {
  axis: number;
  display: number;
}

/** A detection step fed one raw snapshot at a time; `push` returns the result once the step has completed. */
export interface Detector<T> {
  push(raw: RawSnapshot, t: number): T | undefined;
  readonly candidate: AxisCandidate | undefined;
}

/** An axis's values since it first reported something other than its value at the start of the step. */
interface Travel {
  min: number;
  max: number;
  values: number[];
}

/**
 * Follows every axis not in `exclude`. An axis starts travelling at its first sample that differs from its value in
 * the step's first snapshot, so a jump away from a stale initial value is never counted as movement.
 */
function createTravels(exclude: readonly number[]): { update(raw: RawSnapshot): void; widest(): { axis: number; tr: Travel; v: number } | undefined } {
  let initial: number[] | undefined;
  const travels: (Travel | undefined)[] = [];
  return {
    update(raw) {
      initial ??= [...raw.axes];
      raw.axes.forEach((v, i) => {
        if (exclude.includes(i)) return;
        const tr = travels[i];
        if (tr) {
          tr.min = Math.min(tr.min, v);
          tr.max = Math.max(tr.max, v);
          tr.values.push(v);
        } else if (v !== initial?.[i]) travels[i] = { min: v, max: v, values: [v] };
      });
    },
    widest() {
      let best: { axis: number; tr: Travel; v: number } | undefined;
      travels.forEach((tr, axis) => {
        if (!tr || tr.max - tr.min < JITTER || (best && tr.max - tr.min <= best.tr.max - best.tr.min)) return;
        best = { axis, tr, v: tr.values[tr.values.length - 1] ?? tr.min };
      });
      return best;
    },
  };
}

/** Returns a check that is true once `ok` has held for `ms` on one axis while the value stayed within STEADY. */
function createHold(ms: number): (axis: number | undefined, v: number, ok: boolean, t: number) => boolean {
  let held: { axis: number; since: number; value: number } | undefined;
  return (axis, v, ok, t) => {
    if (axis === undefined || !ok) {
      held = undefined;
      return false;
    }
    if (held?.axis !== axis || Math.abs(v - held.value) > STEADY) held = { axis, since: t, value: v };
    return t - held.since >= ms;
  };
}

/**
 * Detects the throttle's top: the unassigned axis with the widest travel (at least 0.5), held steady for 0.4 s at an
 * end of that travel. The held value is the top.
 */
export function createThrottleTopDetector(exclude: readonly number[]): Detector<{ axis: number; top: number }> {
  const travels = createTravels(exclude);
  const hold = createHold(THROTTLE_HOLD_MS);
  let candidate: AxisCandidate | undefined;
  let result: { axis: number; top: number } | undefined;
  return {
    get candidate() {
      return candidate;
    },
    push(raw, t) {
      if (result) return result;
      travels.update(raw);
      const w = travels.widest();
      const start = w?.tr.values[0] ?? 0;
      candidate = w && { axis: w.axis, display: clamp(-1 + Math.abs(w.v - start), -1, 1) };
      const atEnd = w !== undefined && w.tr.max - w.tr.min >= TOP_TRAVEL && (Math.abs(w.v - w.tr.min) <= STEADY || Math.abs(w.v - w.tr.max) <= STEADY);
      if (w && hold(w.axis, w.v, atEnd, t)) result = { axis: w.axis, top: w.v };
      return result;
    },
  };
}

/** Detects the throttle's bottom on `axis`: held steady for 0.4 s at least MIN_RANGE away from `top`. */
export function createThrottleBottomDetector(axis: number, top: number): Detector<number> {
  const hold = createHold(THROTTLE_HOLD_MS);
  let candidate: AxisCandidate | undefined;
  let result: number | undefined;
  return {
    get candidate() {
      return candidate;
    },
    push(raw, t) {
      if (result !== undefined) return result;
      const v = raw.axes[axis];
      if (v === undefined) return undefined;
      candidate = { axis, display: clamp(1 - Math.abs(v - top), -1, 1) };
      if (hold(axis, v, Math.abs(v - top) >= MIN_RANGE, t)) result = v;
      return result;
    },
  };
}

/**
 * Detects a right-stick axis: the unassigned axis with the widest travel (at least MIN_RANGE), back and held steady
 * for 0.3 s near the middle of its range with travel of at least JITTER on both sides. The held value is the rest;
 * the side first left from it is the end the prompt names first (`firstEnd`: left is negative, up is positive).
 */
export function createStickDetector(exclude: readonly number[], firstEnd: 'negative' | 'positive'): Detector<StickMapping> {
  const travels = createTravels(exclude);
  const hold = createHold(STICK_HOLD_MS);
  let candidate: AxisCandidate | undefined;
  let result: StickMapping | undefined;
  return {
    get candidate() {
      return candidate;
    },
    push(raw, t) {
      if (result) return result;
      travels.update(raw);
      const w = travels.widest();
      if (!w) {
        candidate = undefined;
        hold(undefined, 0, false, t);
        return undefined;
      }
      const { axis, tr, v } = w;
      const start = tr.values[0] ?? v;
      const away = tr.values.find((x) => Math.abs(x - start) >= JITTER) ?? v;
      candidate = { axis, display: clamp(Math.sign(away - start) * (v - start), -1, 1) };
      const ok = tr.max - tr.min >= MIN_RANGE && v - tr.min >= JITTER && tr.max - v >= JITTER && Math.abs(v - (tr.min + tr.max) / 2) <= REST_CENTRE;
      if (!hold(axis, v, ok, t)) return undefined;
      const first = Math.sign((tr.values.find((x) => Math.abs(x - v) >= JITTER) ?? v) - v);
      const firstValue = first > 0 ? tr.max : tr.min;
      const secondValue = first > 0 ? tr.min : tr.max;
      result =
        firstEnd === 'negative'
          ? { axis, rest: v, negative: firstValue, positive: secondValue }
          : { axis, rest: v, negative: secondValue, positive: firstValue };
      return result;
    },
  };
}

/**
 * Detects the Arm switch: the first unassigned axis that jumps at least 0.5 from its value in the step's first
 * snapshot and holds steady there, or the first button that changes state and holds, each for 0.25 s. A jump from a
 * stale initial value is a flip. The position after the flip means armed.
 */
export function createArmDetector(exclude: readonly number[]): Detector<ArmMapping> {
  let base: RawSnapshot | undefined;
  const axisHold: ({ value: number; since: number } | undefined)[] = [];
  const buttonSince: (number | undefined)[] = [];
  let result: ArmMapping | undefined;
  return {
    candidate: undefined,
    push(raw, t) {
      if (result !== undefined) return result;
      base ??= { id: raw.id, axes: [...raw.axes], buttons: [...raw.buttons] };
      for (let i = 0; i < raw.axes.length && !result; i++) {
        const v = raw.axes[i] ?? 0;
        const b = base.axes[i];
        if (exclude.includes(i) || b === undefined || Math.abs(v - b) < ARM_JUMP) {
          axisHold[i] = undefined;
          continue;
        }
        const h = axisHold[i];
        if (!h || Math.abs(v - h.value) > ARM_STEADY) axisHold[i] = { value: v, since: t };
        else if (t - h.since >= ARM_HOLD_MS) result = { kind: 'axis', axis: i, armed: v };
      }
      for (let i = 0; i < raw.buttons.length && !result; i++) {
        const p = raw.buttons[i] ?? false;
        if (p === (base.buttons[i] ?? false)) buttonSince[i] = undefined;
        else if (buttonSince[i] === undefined) buttonSince[i] = t;
        else if (t - (buttonSince[i] ?? t) >= ARM_HOLD_MS) result = { kind: 'button', button: i, pressed: p };
      }
      return result;
    },
  };
}
