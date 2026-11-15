import { CATCH, SHIP_CATCH } from '../tuning.ts';
import type { InputState, SpeedLight, Stars, Tower } from '../types.ts';

/** The tunables of a catch; `belly` is present for a vehicle that starts in a belly-flop. */
export type CatchTuning = typeof CATCH & { readonly belly?: typeof SHIP_CATCH.belly };

/** The ship catch's tunables: `CATCH` with `SHIP_CATCH` laid over it. */
export const SHIP_TUNING: CatchTuning = { ...CATCH, ...SHIP_CATCH };

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
  /** The caught vehicle's `catchPinHeight`, `radius` and `height`. */
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
  | { type: 'flipNow' }
  | { type: 'caught'; hard: boolean; stars: Stars; offset: number }
  | { type: 'crash'; kind: CrashKind; at: Point };

/**
 * The vehicle's state. Position is the centre of its base when upright; +Y up, the tower's axis at x = 0, z = 0. In the
 * belly-flop the hull lies with its nose towards -X; the flip turns it upright about its middle, (x, y + height / 2, z).
 */
export interface CatchState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 0 empty to 1 full. */
  fuel: number;
  /** The throttle the engines run at: the input's, or 0 before the flip and once the tank is empty. */
  thrust: number;
  /** Lean from upright towards the direction of travel, degrees. */
  tilt: number;
  /** Progress of the flip: 0 in the belly-flop, 1 upright. */
  flip: number;
  /** Seconds since the start. */
  time: number;
  phase: 'flying' | 'caught' | 'crashed';
  light: SpeedLight;
  /** Whether the vehicle has not been sinking for `stallSeconds` with its pins above `approachHeight`. */
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

/** The vertical speed the engines settle to at throttle `t`: falling below the hover throttle, climbing above it. */
export function settledSpeed(c: CatchTuning, t: number): number {
  if (t < c.hoverThrottle) return -c.fallSpeed * (1 - t / c.hoverThrottle) ** 2;
  return (c.climbSpeed * (t - c.hoverThrottle)) / (1 - c.hoverThrottle);
}

/** Height a vehicle descending at `v` needs to slow below `softSpeed` at full throttle, reaction time included. */
export function brakeDistance(c: CatchTuning, v: number): number {
  const s = c.softSpeed;
  if (v <= s) return 0;
  const k = c.climbSpeed;
  return c.speedLag * (v - s - k * Math.log((k + v) / (k + s))) + v * c.brakeReaction;
}

/** The speed light for pins `h` metres above the catch point descending at `v`. */
export function speedLight(c: CatchTuning, h: number, v: number): SpeedLight {
  if (h < c.finalHeight) return v < c.softSpeed ? 'green' : v < c.hardSpeed ? 'yellow' : 'red';
  const d = brakeDistance(c, v);
  return h < d ? 'red' : h < c.yellowFactor * d ? 'yellow' : 'green';
}

/** The speed light before the flip for pins `h` metres above the catch point: yellow in the comfortable range, red below. */
export function flipLight(belly: NonNullable<CatchTuning['belly']>, h: number): SpeedLight {
  return h > belly.flipTop ? 'green' : h > belly.flipBottom ? 'yellow' : 'red';
}

/** The eased share of the flip done at flip progress `flip`: 0 in the belly-flop, 1 upright. */
export function flipEase(flip: number): number {
  const t = clamp(flip, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The hull's long axis, base to nose, at flip progress `flip`: horizontal towards -X in the belly-flop; the flip raises
 * the nose by `flipEase` × 90° while turning its heading by the same share from -X to -Z, and ends at +Y.
 */
export function hullAxis(flip: number): Point {
  if (flip >= 1) return { x: 0, y: 1, z: 0 };
  const a = (Math.PI / 2) * flipEase(flip);
  const flat = Math.cos(a);
  return { x: -flat * Math.cos(a), y: Math.sin(a), z: -flat * Math.sin(a) };
}

/** The centre of the hull's base end: the base when upright, swung about the hull's middle during the flip. */
export function hullBase(state: CatchState, height: number): Point {
  const a = hullAxis(state.flip);
  return { x: state.x - (height / 2) * a.x, y: state.y + (height / 2) * (1 - a.y), z: state.z - (height / 2) * a.z };
}

/** Whether a vehicle centred at (x, z) sits in the catch box: its hull between the open arms, clear of them and the tower. */
export function inCatchBox(c: CatchTuning, geo: CatchGeometry, x: number, z: number): boolean {
  if (x < -c.boxBack || x > c.boxFront) return false;
  return Math.abs(z) <= geo.catchHalfWidth + x * geo.arms.openSlope - geo.radius - c.boxMargin;
}

/** Half the catch box's width across the axis. */
export function catchBoxHalfWidth(c: CatchTuning, geo: CatchGeometry): number {
  return geo.catchHalfWidth - geo.radius - c.boxMargin;
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

/** Creates a descent from `startHeight` under the tunables `c`, its start direction drawn from `random` (uniform in [0, 1)). */
export function createCatchSim(c: CatchTuning, geo: CatchGeometry, random: () => number): CatchSim {
  const angle = (((random() * 2 - 1) * c.startSpread) / 180) * Math.PI;
  const belly = c.belly;
  const state: CatchState = {
    x: Math.cos(angle) * c.startOffset,
    y: c.startHeight,
    z: Math.sin(angle) * c.startOffset,
    vx: 0,
    vy: -c.startDescent,
    vz: 0,
    fuel: 1,
    thrust: 0,
    tilt: 0,
    flip: belly ? 0 : 1,
    time: 0,
    phase: 'flying',
    light: 'green',
    stalled: false,
  };
  const assistRadius = c.assistRadiusFactor * 2 * catchBoxHalfWidth(c, geo);
  const assistMax = c.assistMaxShare * c.stickAccel;
  const H = geo.height;
  const r = geo.radius;
  let lowFuelSaid = false;
  let slowerIn = 0;
  let descendIn = 0;
  let notSinking = 0;
  let flipCallAt = belly ? belly.flipTop : -Infinity;

  const crash = (kind: CrashKind, at: Point): CatchEvent => {
    state.phase = 'crashed';
    return { type: 'crash', kind, at };
  };

  /** The hull's axis and the centre of its base end. */
  const hull = (): { axis: Point; flat: number; base: Point } => {
    const axis = hullAxis(state.flip);
    return { axis, flat: Math.hypot(axis.x, axis.z), base: hullBase(state, H) };
  };

  /** Points along the hull's axis, about a metre apart, whose height lies between `lo` and `hi`. */
  const axisPoints = (lo: number, hi: number): Point[] => {
    const { axis, base } = hull();
    const up = axis.y;
    let s0 = 0;
    let s1 = H;
    if (up > 0) {
      s0 = Math.max(0, (lo - base.y) / up);
      s1 = Math.min(H, (hi - base.y) / up);
    } else if (base.y < lo || base.y > hi) return [];
    if (s0 > s1) return [];
    const n = Math.max(1, Math.ceil(s1 - s0));
    const points: Point[] = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      points.push({ x: base.x + axis.x * s, y: base.y + up * s, z: base.z + axis.z * s });
    }
    return points;
  };

  /** The collision of the hull with the tower or the arms, if any. */
  const collision = (): CatchEvent | undefined => {
    const { flat } = hull();
    const f = geo.footprint;
    const centreY = state.y + H / 2;
    for (const p of axisPoints(-Infinity, f.top + r * flat)) {
      const tx = clamp(p.x, f.minX, f.maxX);
      const tz = clamp(p.z, -f.halfZ, f.halfZ);
      if (Math.hypot(p.x - tx, p.z - tz) < r) return crash('tower', { x: tx, y: Math.min(f.top, Math.max(p.y, centreY)), z: tz });
    }
    const band = geo.arms.halfHeight + r * flat;
    for (const p of axisPoints(geo.catchY - band, geo.catchY + band)) {
      for (const side of [1, -1]) {
        const [ax, az] = nearestOnArm(geo, side, p.x, p.z);
        if (Math.hypot(p.x - ax, p.z - az) < r + geo.arms.halfWidth) return crash('arms', { x: ax, y: geo.catchY - 1, z: az });
      }
    }
    return undefined;
  };

  /** The outcome of the pins reaching the catch point's height inside the catch box. */
  const catchCheck = (): CatchEvent => {
    const at = { x: state.x, y: geo.catchY, z: state.z };
    const v = -state.vy;
    if (state.fuel <= 0) return crash('noFuel', at);
    if (state.tilt >= c.maxTilt || state.flip < 1) return crash('tilted', at);
    if (v >= c.hardSpeed) return crash('tooFast', at);
    state.phase = 'caught';
    const offset = Math.hypot(state.x, state.z);
    const centred = offset <= c.centreRadius;
    const hard = v >= c.softSpeed;
    const stars: Stars = hard ? (centred ? 2 : 1) : centred ? 3 : 2;
    return { type: 'caught', hard, stars, offset };
  };

  const step = (dt: number, input: InputState): CatchEvent[] => {
    if (state.phase !== 'flying') return [];
    const events: CatchEvent[] = [];

    if (belly && state.flip < 1 && (state.flip > 0 || input.throttle > belly.flipThrottle)) {
      state.flip = Math.min(1, state.flip + dt / belly.flipSeconds);
    }
    const lit = state.flip > 0 && state.fuel > 0;
    state.thrust = lit ? clamp(input.throttle, 0, 1) : 0;
    if (lit) {
      state.fuel = Math.max(0, state.fuel - (state.thrust * dt) / c.fuelSeconds);
      if (!lowFuelSaid && state.fuel <= c.lowFuel) {
        lowFuelSaid = true;
        events.push({ type: 'lowFuel' });
      }
      if (state.fuel === 0) {
        state.thrust = 0;
        events.push({ type: 'fuelEmpty' });
      }
    }

    let target = settledSpeed(c, state.thrust);
    if (state.flip < 1) {
      target = -c.startDescent + (target + c.startDescent) * hullAxis(state.flip).y;
    }
    const dv = (target - state.vy) * (1 - Math.exp(-dt / c.speedLag));
    state.vy += Math.max(dv, -c.gravity * dt);

    let ax = clamp(input.stickX, -1, 1) * c.stickAccel - c.damping * state.vx;
    let az = -clamp(input.stickY, -1, 1) * c.stickAccel - c.damping * state.vz;
    const d = Math.hypot(state.x, state.z);
    if (d < assistRadius && d > 0) {
      const pull = Math.min(assistMax, c.assistPull * d);
      ax += (-state.x / d) * pull - c.assistDamping * state.vx;
      az += (-state.z / d) * pull - c.assistDamping * state.vz;
    }
    if (d > c.areaRadius) {
      const push = (d - c.areaRadius) * c.stickAccel * 0.1;
      ax -= (state.x / d) * push;
      az -= (state.z / d) * push;
    }
    state.vx += ax * dt;
    state.vz += az * dt;

    const pinBefore = state.y + geo.pinHeight;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    state.y += state.vy * dt;
    if (state.y > c.startHeight) {
      state.y = c.startHeight;
      state.vy = Math.min(0, state.vy);
    }
    state.tilt = Math.hypot(state.vx, state.vz) * c.tiltPerSpeed;
    state.time += dt;

    const pinAfter = state.y + geo.pinHeight;
    const hit = collision();
    if (hit) return [...events, hit];
    if (pinBefore > geo.catchY && pinAfter <= geo.catchY && inCatchBox(c, geo, state.x, state.z)) return [...events, catchCheck()];
    const { flat, base } = hull();
    const groundY = Math.hypot(base.x, base.z) < geo.mountRadius + r ? geo.mountTop : 0;
    if (base.y - r * flat <= groundY) return [...events, crash('ground', { x: base.x, y: groundY, z: base.z })];

    const h = pinAfter - geo.catchY;
    if (belly && state.flip === 0) {
      state.light = flipLight(belly, h);
      if (h <= flipCallAt) {
        flipCallAt = flipCallAt === belly.flipTop ? belly.flipTop - belly.flipRepeatDrop : -Infinity;
        events.push({ type: 'flipNow' });
      }
    } else {
      state.light = speedLight(c, h, -state.vy);
      slowerIn -= dt;
      if (state.light === 'red' && slowerIn <= 0) {
        slowerIn = c.slowerEvery;
        events.push({ type: 'slower' });
      }
    }
    const high = h > c.approachHeight;
    notSinking = high && -state.vy < c.stallSpeed ? notSinking + dt : 0;
    state.stalled = notSinking >= c.stallSeconds;
    descendIn -= dt;
    if (state.stalled && descendIn <= 0) {
      descendIn = c.descendEvery;
      events.push({ type: 'descend' });
    }
    return events;
  };

  return { state, step };
}
