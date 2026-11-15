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

const THROTTLE_HOLD = { within: 0.1, ms: 400 };
const STICK_REST_HOLD = { within: 0.15, ms: 300 };
const STEADY = 0.1;
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

/** The axis a detection step is currently following; `display` is −1…+1 with +1 in the prompt's first direction. */
export interface AxisCandidate {
  axis: number;
  display: number;
}

/** A detection step fed one raw snapshot at a time; `push` returns the result once the step has completed. */
export interface Detector<T> {
  push(raw: RawSnapshot, t: number): T | undefined;
  readonly candidate: AxisCandidate | undefined;
}

/** Per-axis travel since the baseline: range, side of the first departure and the number of reversals. */
interface Travel {
  base: number;
  min: number;
  max: number;
  /** Sign of the first departure of at least JITTER from the baseline; 0 before it. */
  first: number;
  /** Direction of the current excursion; 0 before the first departure. */
  dir: number;
  peak: number;
  turns: number;
}

function newTravel(base: number): Travel {
  return { base, min: base, max: base, first: 0, dir: 0, peak: base, turns: 0 };
}

function advance(tr: Travel, v: number): void {
  tr.min = Math.min(tr.min, v);
  tr.max = Math.max(tr.max, v);
  if (tr.dir === 0) {
    if (Math.abs(v - tr.base) >= JITTER) tr.first = tr.dir = Math.sign(v - tr.base);
    tr.peak = v;
  } else if ((v - tr.peak) * tr.dir > 0) {
    tr.peak = v;
  } else if ((tr.peak - v) * tr.dir >= JITTER) {
    tr.dir = -tr.dir;
    tr.peak = v;
    tr.turns += 1;
  }
}

/**
 * Follows every unassigned axis and picks the one with the largest range (at least JITTER) as the candidate.
 * `settled` decides, per sample, whether the candidate is in its completion pose; it must hold there, steady within STEADY, for `holdMs`.
 */
function createAxisStep<T>(
  exclude: readonly number[],
  holdMs: number,
  settled: (tr: Travel, v: number) => boolean,
  finish: (tr: Travel, axis: number, v: number) => T,
  display: (tr: Travel, v: number) => number,
): Detector<T> {
  let travels: (Travel | undefined)[] | undefined;
  let candidate: AxisCandidate | undefined;
  let held: { axis: number; since: number; value: number } | undefined;
  let result: T | undefined;
  return {
    get candidate() {
      return candidate;
    },
    push(raw, t) {
      if (result !== undefined) return result;
      travels ??= raw.axes.map((v, i) => (exclude.includes(i) ? undefined : newTravel(v)));
      let best: { axis: number; tr: Travel; v: number } | undefined;
      raw.axes.forEach((v, i) => {
        const tr = travels?.[i];
        if (!tr) return;
        advance(tr, v);
        const range = tr.max - tr.min;
        if (range >= JITTER && (!best || range > best.tr.max - best.tr.min)) best = { axis: i, tr, v };
      });
      if (!best) {
        candidate = held = undefined;
        return undefined;
      }
      const { axis, tr, v } = best;
      candidate = { axis, display: clamp(display(tr, v), -1, 1) };
      if (tr.max - tr.min < MIN_RANGE || !settled(tr, v)) {
        held = undefined;
        return undefined;
      }
      if (held?.axis !== axis || Math.abs(v - held.value) > STEADY) held = { axis, since: t, value: v };
      if (t - held.since >= holdMs) result = finish(tr, axis, v);
      return result;
    },
  };
}

/**
 * Detects the throttle: moved to both ends and held at the end it stops at, after at least one reversal.
 * The end it is held at is the bottom; the other end is the top.
 */
export function createThrottleDetector(exclude: readonly number[]): Detector<ThrottleMapping> {
  const nearEnd = (tr: Travel, v: number): number | undefined =>
    Math.abs(v - tr.min) <= THROTTLE_HOLD.within ? tr.min : Math.abs(v - tr.max) <= THROTTLE_HOLD.within ? tr.max : undefined;
  return createAxisStep(
    exclude,
    THROTTLE_HOLD.ms,
    (tr, v) => tr.turns >= 1 && nearEnd(tr, v) !== undefined,
    (tr, axis, v) => {
      const bottom = nearEnd(tr, v) ?? v;
      return { axis, bottom, top: bottom === tr.min ? tr.max : tr.min };
    },
    (tr, v) => (tr.first || 1) * v,
  );
}

/**
 * Detects a right-stick axis: moved to both sides of its baseline and back to within 0.15 of it.
 * `firstEnd` names which end the prompt asks for first (left is negative, up is positive).
 */
export function createStickDetector(exclude: readonly number[], firstEnd: 'negative' | 'positive'): Detector<StickMapping> {
  return createAxisStep(
    exclude,
    STICK_REST_HOLD.ms,
    (tr, v) => tr.min <= tr.base - JITTER && tr.max >= tr.base + JITTER && Math.abs(v - tr.base) <= STICK_REST_HOLD.within,
    (tr, axis) => {
      const firstValue = tr.first > 0 ? tr.max : tr.min;
      const secondValue = tr.first > 0 ? tr.min : tr.max;
      return firstEnd === 'negative'
        ? { axis, rest: tr.base, negative: firstValue, positive: secondValue }
        : { axis, rest: tr.base, negative: secondValue, positive: firstValue };
    },
    (tr, v) => (tr.first || 1) * (v - tr.base),
  );
}

/**
 * Detects the Arm switch: the first unassigned axis that jumps at least 0.5 from its baseline and holds steady there,
 * or the first button that changes state and holds, each for 0.25 s. The position after the flip means armed.
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
