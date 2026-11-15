import { REENTRY } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';

/** Where the re-entry is; the last two are endings. */
export type ReentryPhase = 'flying' | 'burnedUp' | 'complete';

/** Something that happened during one step. */
export type ReentryEvent = { kind: 'hot' } | { kind: 'burnup' } | { kind: 'complete'; stars: Stars };

/** A world direction. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/** A shove of the air: a roll and pitch rate along a direction that rises and falls over its length. */
interface Shove {
  roll: number;
  pitch: number;
  rate: number;
  length: number;
  t: number;
}

/**
 * The whole state of a re-entry run. The ship falls belly-first (belly down, nose towards -Z) and the error is its
 * turn away from that attitude, in degrees: `roll` about its long axis, positive with its right side (+X) down, and
 * `pitch` about its right axis, positive nose-down. Stick right rolls right, stick up (pushed forward) pitches nose-down
 * and stick down (pulled back) raises the nose, as an RC pilot flies.
 */
export interface ReentryState {
  phase: ReentryPhase;
  /** Seconds of stage time. */
  t: number;
  roll: number;
  pitch: number;
  /** 0 cool to 1 burning up. */
  heat: number;
  /** Highest heat so far. */
  maxHeat: number;
  /** Seconds until `hot` may be given again. */
  hotWait: number;
  shove: Shove | undefined;
  /** Seconds until the next shove while none pushes. */
  gapLeft: number;
  /** Stars awarded on completion. */
  stars: Stars;
}

const smooth = (f: number): number => {
  const x = Math.min(1, Math.max(0, f));
  return x * x * (3 - 2 * x);
};

const lerp = (range: readonly [number, number], f: number): number => range[0] + (range[1] - range[0]) * f;

/** The heating's intensity at stage time `t`, 0 to 1. */
export function intensityAt(t: number): number {
  const { glowFrom, peakFrom, peakTo, fadeTo } = REENTRY;
  if (t < peakFrom) return smooth((t - glowFrom) / (peakFrom - glowFrom));
  return 1 - smooth((t - peakTo) / (fadeTo - peakTo));
}

/** The error's size, roll and pitch together, in degrees. */
export function errorOf(s: ReentryState): number {
  return Math.hypot(s.roll, s.pitch);
}

/** The ship's nose, right side and belly as world unit vectors: rolled about the nose first, then pitched about the right side. */
export function attitudeOf(s: ReentryState): { nose: Point; right: Point; belly: Point } {
  const r = (s.roll * Math.PI) / 180;
  const p = (s.pitch * Math.PI) / 180;
  const right = { x: Math.cos(r), y: -Math.sin(r), z: 0 };
  const rolledBelly = { x: -Math.sin(r), y: -Math.cos(r), z: 0 };
  const nose = { x: rolledBelly.x * Math.sin(p), y: rolledBelly.y * Math.sin(p), z: -Math.cos(p) };
  const belly = { x: rolledBelly.x * Math.cos(p), y: rolledBelly.y * Math.cos(p), z: Math.sin(p) };
  return { nose, right, belly };
}

/** A fresh run at stage time 0 with the ship in the safe attitude and cool. */
export function createReentry(): ReentryState {
  return { phase: 'flying', t: 0, roll: 0, pitch: 0, heat: 0, maxHeat: 0, hotWait: 0, shove: undefined, gapLeft: REENTRY.glowFrom, stars: 0 };
}

function newShove(random: () => number): Shove {
  const a = random() * 2 * Math.PI;
  return { roll: Math.cos(a), pitch: Math.sin(a), rate: lerp(REENTRY.shoveRate, random()), length: lerp(REENTRY.shoveSeconds, random()), t: 0 };
}

function starsOf(maxHeat: number): Stars {
  if (maxHeat < REENTRY.threeStarHeat) return 3;
  if (maxHeat < REENTRY.twoStarHeat) return 2;
  return 1;
}

/** Advances the run by `dt` seconds with input `input`; returns what happened, in order. */
export function stepReentry(s: ReentryState, dt: number, input: InputState, random: () => number): ReentryEvent[] {
  const events: ReentryEvent[] = [];
  if (s.phase !== 'flying') return events;
  s.t += dt;
  const intensity = intensityAt(s.t);

  let pushRoll = 0;
  let pushPitch = 0;
  if (s.shove) {
    const g = s.shove;
    g.t += dt;
    const push = g.rate * Math.sin((Math.PI * Math.min(g.t, g.length)) / g.length) ** 2 * intensity;
    pushRoll = g.roll * push;
    pushPitch = g.pitch * push;
    if (g.t >= g.length) {
      s.shove = undefined;
      s.gapLeft = lerp(REENTRY.shoveGap, random());
    }
  } else if ((s.gapLeft -= dt) <= 0) s.shove = newShove(random);

  const growth = REENTRY.errorGrowth * intensity;
  s.roll += (pushRoll + growth * s.roll + REENTRY.stickRate * input.stickX) * dt;
  s.pitch += (pushPitch + growth * s.pitch + REENTRY.stickRate * input.stickY) * dt;
  const error = errorOf(s);
  if (error > REENTRY.maxError) {
    s.roll *= REENTRY.maxError / error;
    s.pitch *= REENTRY.maxError / error;
  }

  const x = Math.min(error, REENTRY.maxError) / REENTRY.limit;
  s.heat = Math.max(0, s.heat + (intensity * (REENTRY.heatBase + REENTRY.heatError * x * x) - REENTRY.cooling * s.heat) * dt);
  s.maxHeat = Math.max(s.maxHeat, s.heat);
  if (s.heat >= 1) {
    s.heat = 1;
    s.phase = 'burnedUp';
    events.push({ kind: 'burnup' });
    return events;
  }
  s.hotWait -= dt;
  if (s.heat >= REENTRY.hotHeat && s.hotWait <= 0) {
    s.hotWait = REENTRY.hotEvery;
    events.push({ kind: 'hot' });
  }
  if (s.t >= REENTRY.fadeTo) {
    s.stars = starsOf(s.maxHeat);
    s.phase = 'complete';
    events.push({ kind: 'complete', stars: s.stars });
  }
  return events;
}
