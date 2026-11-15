import { MAXQ } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';

/** Where the ascent is: flying, or one of the two endings. */
export type MaxqPhase = 'flying' | 'broken' | 'complete';

/** What the throttle should do: full before the dense air, inside the band through it, full again after it. */
export type MaxqAir = 'before' | 'ease' | 'full';

/** Something that happened during one step. */
export type MaxqEvent =
  | { kind: 'intro' }
  | { kind: 'ease' }
  | { kind: 'full' }
  | { kind: 'ring'; index: number; hit: boolean }
  | { kind: 'overload' }
  | { kind: 'breakup' }
  | { kind: 'complete'; stars: Stars };

/** A ring of light standing across the path at distance `s`, its centre `x` right and `y` up from the centre line. */
export interface MaxqRing {
  readonly s: number;
  readonly x: number;
  readonly y: number;
  /** Undefined until the rocket passes it. */
  hit: boolean | undefined;
}

/** A point of the path relative to its start and the path's frame there, all unit vectors in world axes (x, y, z). */
export interface PathFrame {
  position: [number, number, number];
  /** Along the path, the way the rocket flies. */
  tangent: [number, number, number];
  /** Across the path: screen up as seen from behind the rocket. Screen right is world +X throughout. */
  up: [number, number, number];
}

/** The whole state of an ascent run. Across-path offsets are in metres, `x` towards screen right and `y` screen up. */
export interface MaxqState {
  phase: MaxqPhase;
  /** Seconds since the start. */
  t: number;
  /** Distance flown along the path. */
  s: number;
  /** Speed along the path. */
  speed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Air pressure on the rocket, 0 to beyond 1. */
  pressure: number;
  air: MaxqAir;
  /** Total seconds in the red. */
  stress: number;
  /** Seconds of the current spell in the red, 0 outside it. */
  spell: number;
  /** Seconds until `overload` may sound again within a spell. */
  overloadWait: number;
  rings: MaxqRing[];
  /** Index of the next ring to pass. */
  next: number;
  hits: number;
  /** Stars awarded on completion. */
  stars: Stars;
}

/** Share of the full path, 0 to 1. */
export function progressOf(s: MaxqState): number {
  return Math.min(1, s.s / MAXQ.length);
}

/** The air pressure at full speed at path share `u`: a rise from the start to the peak and a fall to the end. */
export function densityAt(u: number): number {
  const p = MAXQ.peakAt;
  if (u <= p) return MAXQ.densityStart + ((MAXQ.densityPeak - MAXQ.densityStart) * (1 - Math.cos((Math.PI * Math.max(0, u)) / p))) / 2;
  return MAXQ.densityEnd + ((MAXQ.densityPeak - MAXQ.densityEnd) * (1 + Math.cos((Math.PI * Math.min(1, u - p)) / (1 - p)))) / 2;
}

/** The speed along the path the throttle settles to. */
export function speedFor(throttle: number): number {
  const t = Math.min(1, Math.max(0, throttle));
  return MAXQ.topSpeed * (MAXQ.idleShare + (1 - MAXQ.idleShare) * t);
}

/** The air pressure at path share `u` flying at `speed`. */
export function pressureAt(u: number, speed: number): number {
  return densityAt(u) * (speed / MAXQ.topSpeed) ** 2;
}

/** The path at distance `s` from its start: it bends from `pitchStart` to `pitchEnd` degrees off upright towards -Z. */
export function pathFrame(s: number): PathFrame {
  const L = MAXQ.length;
  const a0 = (MAXQ.pitchStart * Math.PI) / 180;
  const a1 = (MAXQ.pitchEnd * Math.PI) / 180;
  const a = a0 + ((a1 - a0) * s) / L;
  const k = L / (a1 - a0);
  return {
    position: [0, k * (Math.sin(a) - Math.sin(a0)), k * (Math.cos(a) - Math.cos(a0))],
    tangent: [0, Math.cos(a), -Math.sin(a)],
    up: [0, Math.sin(a), Math.cos(a)],
  };
}

/** Lays out the rings along the path, each a random step across from the previous one and within `ringSpread`. */
function layRings(random: () => number): MaxqRing[] {
  const rings: MaxqRing[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < MAXQ.rings; i++) {
    const step = MAXQ.ringStep[0] + (MAXQ.ringStep[1] - MAXQ.ringStep[0]) * random();
    let a = random() * Math.PI * 2;
    const nx = x + step * Math.cos(a);
    const ny = y + step * Math.sin(a);
    if (Math.hypot(nx, ny) > MAXQ.ringSpread) a = Math.atan2(-y, -x) + (random() - 0.5) * Math.PI * 0.5;
    x += step * Math.cos(a);
    y += step * Math.sin(a);
    const s = MAXQ.firstRing + ((MAXQ.length - MAXQ.firstRing) * i) / (MAXQ.rings - 1);
    rings.push({ s, x, y, hit: undefined });
  }
  return rings;
}

/** A fresh run at the start of the path at full speed, with rings laid out from `random`. */
export function createMaxq(random: () => number): MaxqState {
  return {
    phase: 'flying',
    t: 0,
    s: 0,
    speed: MAXQ.topSpeed,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    pressure: pressureAt(0, MAXQ.topSpeed),
    air: 'before',
    stress: 0,
    spell: 0,
    overloadWait: 0,
    rings: layRings(random),
    next: 0,
    hits: 0,
    stars: 0,
  };
}

/** The stars a completed run earns. */
export function starsOf(s: MaxqState): Stars {
  const misses = MAXQ.rings - s.hits;
  const slow = s.t > MAXQ.timeLimit;
  if (misses <= MAXQ.missesFor3 && s.stress <= MAXQ.redFor3 && !slow) return 3;
  if (s.hits >= MAXQ.hitsFor2 && s.stress <= MAXQ.redFor2) return 2;
  return 1;
}

/**
 * Advances the run by `dt` seconds with input `input`; returns what happened, in order. After completion the rocket keeps
 * flying. Steering: stick right moves the rocket right on screen; the vertical axis works as an elevator, stick back
 * (down) moves it up on screen and stick forward (up) down.
 */
export function stepMaxq(s: MaxqState, dt: number, input: InputState): MaxqEvent[] {
  const events: MaxqEvent[] = [];
  if (s.phase === 'broken') return events;
  if (s.t === 0 && s.phase === 'flying') events.push({ kind: 'intro' });
  s.t += dt;

  const follow = Math.min(1, dt / MAXQ.speedLag);
  s.speed += (speedFor(input.throttle) - s.speed) * follow;
  const before = s.s;
  s.s += s.speed * dt;

  const lag = Math.min(1, dt / MAXQ.stickLag);
  s.vx += (input.stickX * MAXQ.stickSpeed - s.vx) * lag;
  s.vy += (-input.stickY * MAXQ.stickSpeed - s.vy) * lag;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  const off = Math.hypot(s.x, s.y);
  if (off > MAXQ.maxOffset) {
    s.x *= MAXQ.maxOffset / off;
    s.y *= MAXQ.maxOffset / off;
  }
  if (s.phase === 'complete') return events;

  const u = progressOf(s);
  s.pressure = pressureAt(u, s.speed);
  const density = densityAt(u);
  if (s.air === 'before' && u < MAXQ.peakAt && density >= MAXQ.easeAt) {
    s.air = 'ease';
    events.push({ kind: 'ease' });
  } else if (s.air === 'ease' && u > MAXQ.peakAt && density <= MAXQ.fullAt) {
    s.air = 'full';
    events.push({ kind: 'full' });
  }

  if (s.pressure >= MAXQ.red) {
    s.stress += dt;
    s.spell += dt;
    s.overloadWait -= dt;
    if (s.spell >= MAXQ.overloadAfter && s.overloadWait <= 0) {
      s.overloadWait = MAXQ.overloadRepeat;
      events.push({ kind: 'overload' });
    }
    if (s.stress >= MAXQ.stressLimit) {
      s.phase = 'broken';
      events.push({ kind: 'breakup' });
      return events;
    }
  } else {
    s.spell = 0;
    s.overloadWait = 0;
  }

  for (let ring = s.rings[s.next]; ring && before < ring.s && s.s >= ring.s; ring = s.rings[s.next]) {
    const back = (s.s - ring.s) / Math.max(1e-6, s.s - before);
    const hit = Math.hypot(s.x - s.vx * dt * back - ring.x, s.y - s.vy * dt * back - ring.y) <= MAXQ.ringRadius;
    ring.hit = hit;
    if (hit) s.hits++;
    events.push({ kind: 'ring', index: s.next, hit });
    s.next++;
  }
  if (s.next >= s.rings.length) {
    s.stars = starsOf(s);
    s.phase = 'complete';
    events.push({ kind: 'complete', stars: s.stars });
  }
  return events;
}
