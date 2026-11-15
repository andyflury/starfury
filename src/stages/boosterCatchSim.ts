import { CATCH } from '../tuning.ts';
import type { InputState, SpeedLight, Stars, Tower } from '../types.ts';

/** A point in world space, metres. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/** The world's measurements the simulation needs, read off the world by the stage. */
export interface CatchGeometry {
  /** Height of `tower.catchPoint`. */
  readonly catchY: number;
  /** `tower.catchHalfWidth`. */
  readonly catchHalfWidth: number;
  /** The booster's `catchPinHeight`, `radius` and `height`. */
  readonly pinHeight: number;
  readonly radius: number;
  readonly height: number;
  /** Height of the launch mount's table top. */
  readonly mountTop: number;
  /** Radius of the launch mount's table. */
  readonly mountRadius: number;
  /** The open arms and the tower's solid extent, as the world's tower gives them. */
  readonly arms: Tower['arms'];
  readonly footprint: Tower['footprint'];
}

/** Why a descent ended in an explosion. */
export type CrashKind = 'tooFast' | 'tilted' | 'noFuel' | 'arms' | 'tower' | 'ground';

/** Something that happened during one step. */
export type CatchEvent =
  | { type: 'lowFuel' }
  | { type: 'fuelEmpty' }
  | { type: 'slower' }
  | { type: 'descend' }
  | { type: 'caught'; hard: boolean; stars: Stars; offset: number }
  | { type: 'crash'; kind: CrashKind; at: Point };

/** The booster's state. Position is the centre of its base; +Y up, the tower's axis at x = 0, z = 0. */
export interface CatchState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 0 empty to 1 full. */
  fuel: number;
  /** The throttle the engines run at: the input's, or 0 once the tank is empty. */
  thrust: number;
  /** Lean from upright towards the direction of travel, degrees. */
  tilt: number;
  /** Seconds since the start. */
  time: number;
  phase: 'flying' | 'caught' | 'crashed';
  light: SpeedLight;
  /** Whether the booster has not been sinking for `stallSeconds` with its pins above `approachHeight`. */
  stalled: boolean;
}

/** The descent: its state and the step that advances it. */
export interface CatchSim {
  readonly state: CatchState;
  /** Advances the descent by `dt` seconds under `input`; returns what happened. Does nothing once it has ended. */
  step(dt: number, input: InputState): CatchEvent[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The stick in the simulation's world frame (stickX towards +X, stickY towards -Z) for a screen-relative stick seen by a
 * camera turned `yaw` radians about +Y from facing -Z: right moves right on screen, up moves away from the camera.
 */
export function screenStick(stickX: number, stickY: number, yaw: number): { stickX: number; stickY: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { stickX: stickX * c - stickY * s, stickY: stickX * s + stickY * c };
}

/** The vertical speed the booster settles to at throttle `t`: falling below the hover throttle, climbing above it. */
export function settledSpeed(t: number): number {
  if (t < CATCH.hoverThrottle) return -CATCH.fallSpeed * (1 - t / CATCH.hoverThrottle) ** 2;
  return (CATCH.climbSpeed * (t - CATCH.hoverThrottle)) / (1 - CATCH.hoverThrottle);
}

/** Height a booster descending at `v` needs to slow below `softSpeed` at full throttle, reaction time included. */
export function brakeDistance(v: number): number {
  const s = CATCH.softSpeed;
  if (v <= s) return 0;
  const c = CATCH.climbSpeed;
  return CATCH.speedLag * (v - s - c * Math.log((c + v) / (c + s))) + v * CATCH.brakeReaction;
}

/** The speed light for pins `h` metres above the catch point descending at `v`. */
export function speedLight(h: number, v: number): SpeedLight {
  if (h < CATCH.finalHeight) return v < CATCH.softSpeed ? 'green' : v < CATCH.hardSpeed ? 'yellow' : 'red';
  const d = brakeDistance(v);
  return h < d ? 'red' : h < CATCH.yellowFactor * d ? 'yellow' : 'green';
}

/** Whether a booster centred at (x, z) sits in the catch box: its hull between the open arms, clear of them and the tower. */
export function inCatchBox(geo: CatchGeometry, x: number, z: number): boolean {
  if (x < -CATCH.boxBack || x > CATCH.boxFront) return false;
  return Math.abs(z) <= geo.catchHalfWidth + x * geo.arms.openSlope - geo.radius - CATCH.boxMargin;
}

/** Half the catch box's width across the axis. */
export function catchBoxHalfWidth(geo: CatchGeometry): number {
  return geo.catchHalfWidth - geo.radius - CATCH.boxMargin;
}

/** The point of an open arm's centre line closest to (x, z), for the arm on the side of `side` (±1 in z). */
function nearestOnArm(geo: CatchGeometry, side: number, x: number, z: number): [number, number] {
  const { pivotX, length, openSlope, halfWidth } = geo.arms;
  const n = Math.hypot(1, openSlope);
  const px = pivotX;
  const pz = side * (geo.catchHalfWidth + pivotX * openSlope + halfWidth * n);
  const dx = 1 / n;
  const dz = (side * openSlope) / n;
  const t = clamp((x - px) * dx + (z - pz) * dz, 0, length);
  return [px + t * dx, pz + t * dz];
}

/** Creates a descent from `CATCH.startHeight`, its start direction drawn from `random` (uniform in [0, 1)). */
export function createCatchSim(geo: CatchGeometry, random: () => number): CatchSim {
  const angle = (((random() * 2 - 1) * CATCH.startSpread) / 180) * Math.PI;
  const state: CatchState = {
    x: Math.cos(angle) * CATCH.startOffset,
    y: CATCH.startHeight,
    z: Math.sin(angle) * CATCH.startOffset,
    vx: 0,
    vy: -CATCH.startDescent,
    vz: 0,
    fuel: 1,
    thrust: 0,
    tilt: 0,
    time: 0,
    phase: 'flying',
    light: 'green',
    stalled: false,
  };
  const assistRadius = CATCH.assistRadiusFactor * 2 * catchBoxHalfWidth(geo);
  const assistMax = CATCH.assistMaxShare * CATCH.stickAccel;
  let lowFuelSaid = false;
  let slowerIn = 0;
  let descendIn = 0;
  let notSinking = 0;

  const crash = (kind: CrashKind, at: Point): CatchEvent => {
    state.phase = 'crashed';
    return { type: 'crash', kind, at };
  };

  /** The collision of the booster's hull with the tower or the arms, if any. */
  const collision = (): CatchEvent | undefined => {
    const { x, y, z } = state;
    const r = geo.radius;
    const f = geo.footprint;
    const tx = clamp(x, f.minX, f.maxX);
    const tz = clamp(z, -f.halfZ, f.halfZ);
    if (y < f.top && Math.hypot(x - tx, z - tz) < r) {
      return crash('tower', { x: tx, y: clamp(y + geo.height / 2, y, f.top), z: tz });
    }
    const band = geo.arms.halfHeight;
    const inBand = y < geo.catchY + band && y + geo.height > geo.catchY - band;
    if (!inBand) return undefined;
    for (const side of [1, -1]) {
      const [ax, az] = nearestOnArm(geo, side, x, z);
      if (Math.hypot(x - ax, z - az) < r + geo.arms.halfWidth) return crash('arms', { x: ax, y: geo.catchY - 1, z: az });
    }
    return undefined;
  };

  /** The outcome of the pins reaching the catch point's height inside the catch box. */
  const catchCheck = (): CatchEvent => {
    const at = { x: state.x, y: geo.catchY, z: state.z };
    const v = -state.vy;
    if (state.fuel <= 0) return crash('noFuel', at);
    if (state.tilt >= CATCH.maxTilt) return crash('tilted', at);
    if (v >= CATCH.hardSpeed) return crash('tooFast', at);
    state.phase = 'caught';
    const offset = Math.hypot(state.x, state.z);
    const centred = offset <= CATCH.centreRadius;
    const hard = v >= CATCH.softSpeed;
    const stars: Stars = hard ? (centred ? 2 : 1) : centred ? 3 : 2;
    return { type: 'caught', hard, stars, offset };
  };

  const step = (dt: number, input: InputState): CatchEvent[] => {
    if (state.phase !== 'flying') return [];
    const events: CatchEvent[] = [];

    state.thrust = state.fuel > 0 ? clamp(input.throttle, 0, 1) : 0;
    if (state.fuel > 0) {
      state.fuel = Math.max(0, state.fuel - (state.thrust * dt) / CATCH.fuelSeconds);
      if (!lowFuelSaid && state.fuel <= CATCH.lowFuel) {
        lowFuelSaid = true;
        events.push({ type: 'lowFuel' });
      }
      if (state.fuel === 0) {
        state.thrust = 0;
        events.push({ type: 'fuelEmpty' });
      }
    }

    const dv = (settledSpeed(state.thrust) - state.vy) * (1 - Math.exp(-dt / CATCH.speedLag));
    state.vy += Math.max(dv, -CATCH.gravity * dt);

    let ax = clamp(input.stickX, -1, 1) * CATCH.stickAccel - CATCH.damping * state.vx;
    let az = -clamp(input.stickY, -1, 1) * CATCH.stickAccel - CATCH.damping * state.vz;
    const d = Math.hypot(state.x, state.z);
    if (d < assistRadius && d > 0) {
      const pull = Math.min(assistMax, CATCH.assistPull * d);
      ax += (-state.x / d) * pull - CATCH.assistDamping * state.vx;
      az += (-state.z / d) * pull - CATCH.assistDamping * state.vz;
    }
    if (d > CATCH.areaRadius) {
      const push = (d - CATCH.areaRadius) * CATCH.stickAccel * 0.1;
      ax -= (state.x / d) * push;
      az -= (state.z / d) * push;
    }
    state.vx += ax * dt;
    state.vz += az * dt;

    const pinBefore = state.y + geo.pinHeight;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    state.y += state.vy * dt;
    if (state.y > CATCH.startHeight) {
      state.y = CATCH.startHeight;
      state.vy = Math.min(0, state.vy);
    }
    state.tilt = Math.hypot(state.vx, state.vz) * CATCH.tiltPerSpeed;
    state.time += dt;

    const pinAfter = state.y + geo.pinHeight;
    const hit = collision();
    if (hit) return [...events, hit];
    if (pinBefore > geo.catchY && pinAfter <= geo.catchY && inCatchBox(geo, state.x, state.z)) return [...events, catchCheck()];
    const groundY = Math.hypot(state.x, state.z) < geo.mountRadius + geo.radius ? geo.mountTop : 0;
    if (state.y <= groundY) return [...events, crash('ground', { x: state.x, y: groundY, z: state.z })];

    state.light = speedLight(pinAfter - geo.catchY, -state.vy);
    slowerIn -= dt;
    if (state.light === 'red' && slowerIn <= 0) {
      slowerIn = CATCH.slowerEvery;
      events.push({ type: 'slower' });
    }
    const high = pinAfter - geo.catchY > CATCH.approachHeight;
    notSinking = high && -state.vy < CATCH.stallSpeed ? notSinking + dt : 0;
    state.stalled = notSinking >= CATCH.stallSeconds;
    descendIn -= dt;
    if (state.stalled && descendIn <= 0) {
      descendIn = CATCH.descendEvery;
      events.push({ type: 'descend' });
    }
    return events;
  };

  return { state, step };
}
