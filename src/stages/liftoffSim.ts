import { LIFTOFF } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';

/** Where the liftoff is. `disarm` and `arm` wait for the switch, `throttleDown` for the throttle; the last three are endings. */
export type LiftoffPhase = 'disarm' | 'arm' | 'throttleDown' | 'countdown' | 'ignition' | 'climb' | 'failed' | 'crashed' | 'complete';

/** Something that happened during one step. */
export type LiftoffEvent =
  | { kind: 'prompt'; line: 'disarm_first' | 'arm_prompt' | 'throttle_down' }
  | { kind: 'count'; n: number }
  | { kind: 'ignition' }
  | { kind: 'liftoff' }
  | { kind: 'tiltWarning' }
  | { kind: 'towerClear' }
  | { kind: 'falseStart' }
  | { kind: 'lowThrust' }
  | { kind: 'crash'; cause: 'tower' | 'mount'; at: Point }
  | { kind: 'complete'; stars: Stars };

/** A world position in metres. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/** The launch site as plain numbers. The mount's axis is at x = 0, z = 0. */
export interface LiftoffSite {
  /** Height of the mount's top, where the stack's base stands. */
  readonly padY: number;
  /** The camera's bearing from the stack, radians from +Z towards +X; the stick leans the stack as seen from there. */
  readonly yaw: number;
  /** Length and hull radius of the stacked rocket. */
  readonly length: number;
  readonly radius: number;
  /** The tower's solid box: x from `minX` to `maxX`, |z| up to `halfZ`, y from the ground up to `top`. */
  readonly tower: { readonly minX: number; readonly maxX: number; readonly halfZ: number; readonly top: number };
}

/** A wind gust: a tilt rate along a world direction that rises and falls over its length. */
interface Gust {
  dirX: number;
  dirZ: number;
  rate: number;
  length: number;
  t: number;
}

/** The whole state of a liftoff run. Tilt is how far the rocket's top leans along world X and Z, in degrees. */
export interface LiftoffState {
  readonly site: LiftoffSite;
  phase: LiftoffPhase;
  /** Seconds since the current waiting prompt was given. */
  promptT: number;
  /** Seconds the throttle has been down without a break. */
  downT: number;
  /** Seconds since the countdown started, 0 while waiting and held at T-0 afterwards. */
  countT: number;
  /** The countdown number showing, undefined outside the countdown. */
  digit: number | undefined;
  /** Pad steam, 0 to 1. */
  steam: number;
  /** Seconds since T-0. */
  ignitionT: number;
  /** Seconds from T-0 to reaching the band. */
  bandT: number | undefined;
  /** Seconds since liftoff. */
  climbT: number;
  /** Height of the rocket's base above the pad. */
  altitude: number;
  /** Vertical speed, up positive. */
  speed: number;
  /** Sideways drift of the rocket's base from the mount's axis, world X and Z. */
  x: number;
  z: number;
  /** The automatic sidestep away from the tower, along world +X. */
  sidestep: number;
  tiltX: number;
  tiltZ: number;
  /** Largest tilt since liftoff. */
  maxTilt: number;
  towerCleared: boolean;
  /** Seconds until a tilt warning may play again. */
  warnWait: number;
  gust: Gust | undefined;
  /** Seconds until the next gust while none blows. */
  gapLeft: number;
  /** Stars awarded on completion. */
  stars: Stars;
}

/** Height of the base above the pad at which the stage completes: the full-throttle climb after `climbSeconds`. */
export const COMPLETE_ALTITUDE = (() => {
  const vTop = LIFTOFF.climbAccel / LIFTOFF.climbDrag;
  const tau = 1 / LIFTOFF.climbDrag;
  const t = LIFTOFF.climbSeconds;
  return vTop * (t - tau * (1 - Math.exp(-t / tau)));
})();

/** The tilt's size in degrees. */
export function tiltOf(s: LiftoffState): number {
  return Math.hypot(s.tiltX, s.tiltZ);
}

/** The tilt as seen from the camera, in degrees: `right` towards screen right, `away` away from the camera, the stick's frame. */
export function screenTiltOf(s: LiftoffState): { right: number; away: number } {
  const cos = Math.cos(s.site.yaw);
  const sin = Math.sin(s.site.yaw);
  return { right: s.tiltX * cos - s.tiltZ * sin, away: -s.tiltX * sin - s.tiltZ * cos };
}

/** Where the rocket's base is and the unit direction of its axis, in world space. */
export function poseOf(s: LiftoffState): { base: Point; axis: Point } {
  const t = (tiltOf(s) * Math.PI) / 180;
  const k = t > 0 ? Math.sin(t) / tiltOf(s) : 0;
  return {
    base: { x: s.x + s.sidestep, y: s.site.padY + s.altitude, z: s.z },
    axis: { x: s.tiltX * k, y: Math.cos(t), z: s.tiltZ * k },
  };
}

/** The point along the axis at `f` of the rocket's length. */
function along(s: LiftoffState, f: number): Point {
  const { base, axis } = poseOf(s);
  const d = f * s.site.length;
  return { x: base.x + axis.x * d, y: base.y + axis.y * d, z: base.z + axis.z * d };
}

/** Spacing of the points along the axis tested against the tower, metres. */
const HULL_STEP = 1;

/** The point of the tower's box the hull touches first from the base up, if it touches it. */
export function towerContact(s: LiftoffState): Point | undefined {
  const { tower, length, radius } = s.site;
  const n = Math.ceil(length / HULL_STEP);
  for (let i = 0; i <= n; i++) {
    const p = along(s, i / n);
    const q = {
      x: Math.min(tower.maxX, Math.max(tower.minX, p.x)),
      y: Math.min(tower.top, Math.max(0, p.y)),
      z: Math.min(tower.halfZ, Math.max(-tower.halfZ, p.z)),
    };
    if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= radius) return q;
  }
  return undefined;
}

/** A fresh run with the rocket on the pad at `site`; `armed` is the switch position at the start. */
export function createLiftoff(armed: boolean, site: LiftoffSite): LiftoffState {
  return {
    site,
    phase: armed ? 'disarm' : 'arm',
    promptT: Infinity,
    downT: 0,
    countT: 0,
    digit: undefined,
    steam: 0,
    ignitionT: 0,
    bandT: undefined,
    climbT: 0,
    altitude: 0,
    speed: 0,
    x: 0,
    z: 0,
    sidestep: 0,
    tiltX: 0,
    tiltZ: 0,
    maxTilt: 0,
    towerCleared: false,
    warnWait: 0,
    gust: undefined,
    gapLeft: LIFTOFF.firstGust,
    stars: 0,
  };
}

const lerp = (range: readonly [number, number], f: number): number => range[0] + (range[1] - range[0]) * f;

/** Starts a new gust blowing away from the tower, towards +X within `gustSpread`. */
function newGust(random: () => number): Gust {
  const a = ((random() * 2 - 1) * LIFTOFF.gustSpread * Math.PI) / 180;
  return {
    dirX: Math.cos(a),
    dirZ: Math.sin(a),
    rate: lerp(LIFTOFF.gustRate, random()),
    length: lerp(LIFTOFF.gustSeconds, random()),
    t: 0,
  };
}

function starsOf(s: LiftoffState): Stars {
  const quick = (s.bandT ?? Infinity) <= LIFTOFF.quickBand;
  if (quick && s.maxTilt <= LIFTOFF.smallTilt) return 3;
  if (s.maxTilt <= LIFTOFF.moderateTilt) return 2;
  return 1;
}

/** Gives the waiting prompt `line` when it is due and counts the time since. */
function prompt(s: LiftoffState, dt: number, line: 'disarm_first' | 'arm_prompt' | 'throttle_down', events: LiftoffEvent[]): void {
  if (s.promptT >= LIFTOFF.promptRepeat) {
    s.promptT = 0;
    events.push({ kind: 'prompt', line });
  } else s.promptT += dt;
}

/** Enters a waiting phase; its prompt is given on the next step. */
function wait(s: LiftoffState, phase: 'arm' | 'throttleDown'): void {
  s.phase = phase;
  s.promptT = Infinity;
  s.downT = 0;
  s.countT = 0;
}

function startCountdown(s: LiftoffState, events: LiftoffEvent[]): void {
  s.phase = 'countdown';
  s.countT = 0;
  s.digit = LIFTOFF.countdownFrom;
  events.push({ kind: 'count', n: LIFTOFF.countdownFrom });
}

/** Advances the run by `dt` seconds with input `input`; returns what happened, in order. After completion the rocket coasts upward. */
export function stepLiftoff(s: LiftoffState, dt: number, input: InputState, random: () => number): LiftoffEvent[] {
  const events: LiftoffEvent[] = [];
  switch (s.phase) {
    case 'disarm':
      if (!input.armed) wait(s, 'arm');
      else prompt(s, dt, 'disarm_first', events);
      break;
    case 'arm':
      if (input.armed) {
        if (input.throttle > LIFTOFF.throttleDown) wait(s, 'throttleDown');
        else startCountdown(s, events);
      } else prompt(s, dt, 'arm_prompt', events);
      break;
    case 'throttleDown':
      if (!input.armed) {
        wait(s, 'arm');
        break;
      }
      s.downT = input.throttle <= LIFTOFF.throttleDown ? s.downT + dt : 0;
      if (s.downT >= LIFTOFF.throttleDownHold) startCountdown(s, events);
      else prompt(s, dt, 'throttle_down', events);
      break;
    case 'countdown':
      stepCountdown(s, dt, input, events);
      break;
    case 'ignition':
      s.ignitionT += dt;
      if (input.throttle >= LIFTOFF.liftoffBand) {
        s.bandT = s.ignitionT;
        s.phase = 'climb';
        events.push({ kind: 'liftoff' });
      } else if (s.ignitionT >= LIFTOFF.bandDeadline) {
        s.phase = 'failed';
        events.push({ kind: 'lowThrust' });
      }
      break;
    case 'climb':
      stepClimb(s, dt, input, random, events);
      break;
    case 'complete':
      s.altitude += s.speed * dt;
      break;
    case 'failed':
    case 'crashed':
      break;
  }
  return events;
}

function stepCountdown(s: LiftoffState, dt: number, input: InputState, events: LiftoffEvent[]): void {
  if (!input.armed) {
    s.digit = undefined;
    s.steam = 0;
    wait(s, 'arm');
    return;
  }
  if (input.throttle > LIFTOFF.falseStartThrottle) {
    s.digit = undefined;
    s.phase = 'failed';
    events.push({ kind: 'falseStart' });
    return;
  }
  s.countT += dt;
  const from = LIFTOFF.countdownFrom;
  s.steam = Math.min(1, Math.max(0, (s.countT - (from - LIFTOFF.steamFrom)) / LIFTOFF.steamFrom));
  if (s.countT >= from) {
    s.digit = undefined;
    s.steam = 1;
    s.phase = 'ignition';
    s.ignitionT = 0;
    events.push({ kind: 'ignition' });
    return;
  }
  const digit = from - Math.floor(s.countT);
  if (digit !== s.digit) {
    s.digit = digit;
    events.push({ kind: 'count', n: digit });
  }
}

function stepClimb(s: LiftoffState, dt: number, input: InputState, random: () => number, events: LiftoffEvent[]): void {
  s.climbT += dt;

  const push = (input.throttle - LIFTOFF.hoverThrottle) / (1 - LIFTOFF.hoverThrottle);
  s.speed += (LIFTOFF.climbAccel * push - LIFTOFF.climbDrag * s.speed) * dt;
  s.altitude += s.speed * dt;

  let windX = 0;
  let windZ = 0;
  if (s.gust) {
    const g = s.gust;
    g.t += dt;
    const envelope = Math.sin((Math.PI * Math.min(g.t, g.length)) / g.length) ** 2;
    windX = g.dirX * g.rate * envelope;
    windZ = g.dirZ * g.rate * envelope;
    if (g.t >= g.length) {
      s.gust = undefined;
      s.gapLeft = lerp(LIFTOFF.gustGap, random());
    }
  } else if ((s.gapLeft -= dt) <= 0) s.gust = newGust(random);

  const cos = Math.cos(s.site.yaw);
  const sin = Math.sin(s.site.yaw);
  const stickX = input.stickX * cos - input.stickY * sin;
  const stickZ = -input.stickX * sin - input.stickY * cos;
  s.tiltX += (windX + LIFTOFF.tiltGrowth * s.tiltX + LIFTOFF.stickRate * stickX) * dt;
  s.tiltZ += (windZ + LIFTOFF.tiltGrowth * s.tiltZ + LIFTOFF.stickRate * stickZ) * dt;
  const tilt = tiltOf(s);
  if (tilt > LIFTOFF.maxTilt) {
    s.tiltX *= LIFTOFF.maxTilt / tilt;
    s.tiltZ *= LIFTOFF.maxTilt / tilt;
  }
  const lean = Math.min(tilt, LIFTOFF.maxTilt);
  s.maxTilt = Math.max(s.maxTilt, lean);

  const drift = LIFTOFF.drift * Math.max(0, s.speed) * dt * (Math.PI / 180);
  s.x += drift * s.tiltX;
  s.z += drift * s.tiltZ;
  const step = Math.min(1, s.climbT / LIFTOFF.sidestepSeconds);
  s.sidestep = LIFTOFF.sidestep * step * step * (3 - 2 * step);

  if (s.altitude <= 0 && s.speed < 0) {
    s.altitude = 0;
    s.phase = 'crashed';
    events.push({ kind: 'crash', cause: 'mount', at: along(s, 0.15) });
    return;
  }
  const contact = towerContact(s);
  if (contact) {
    s.phase = 'crashed';
    events.push({ kind: 'crash', cause: 'tower', at: contact });
    return;
  }
  if (!s.towerCleared && lean > LIFTOFF.crashTilt) {
    s.phase = 'crashed';
    events.push({ kind: 'crash', cause: 'tower', at: along(s, 0.55) });
    return;
  }
  s.warnWait -= dt;
  if (lean >= LIFTOFF.crashTilt * LIFTOFF.warnFraction && s.warnWait <= 0) {
    s.warnWait = LIFTOFF.warnCooldown;
    events.push({ kind: 'tiltWarning' });
  }
  if (!s.towerCleared && s.altitude >= LIFTOFF.towerClearHeight) {
    s.towerCleared = true;
    events.push({ kind: 'towerClear' });
  }
  if (s.altitude >= COMPLETE_ALTITUDE) {
    s.stars = starsOf(s);
    s.phase = 'complete';
    events.push({ kind: 'complete', stars: s.stars });
  }
}
