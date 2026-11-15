import { DEPLOY } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';

/** Where the deploy is: the door opening, the release window, the wait for the ending's line, and the ending. */
export type DeployPhase = 'intro' | 'window' | 'finish' | 'done';

/** What became of a satellite. */
export type SatelliteFate = 'aboard' | 'good' | 'bad' | 'lost';

/** Something that happened during one step. */
export type DeployEvent =
  | { kind: 'open' }
  | { kind: 'release'; index: number; good: boolean }
  | { kind: 'closed'; lost: number }
  | { kind: 'complete'; stars: Stars; good: number };

/**
 * The whole state of a deploy run. The attitude error is how far the ship has turned from steady, in degrees, as a
 * lean of the screen's up axis seen from the camera's resting place: `x` towards the screen's right, `y` away from the
 * camera.
 */
export interface DeployState {
  phase: DeployPhase;
  /** Seconds since the start. */
  t: number;
  x: number;
  y: number;
  /** The drift's direction in radians, its rate in degrees per second, its current turn in radians per second, and the seconds until the turn changes. */
  driftAngle: number;
  driftRate: number;
  driftTurn: number;
  driftLeft: number;
  /** The fading turn of the kicks, degrees per second along `x` and `y`. */
  kickX: number;
  kickY: number;
  /** The direction of every kick of this run before the spread, radians. */
  recoil: number;
  /** Seconds until the next release is possible. */
  reload: number;
  /** Seconds until the release window closes. */
  windowLeft: number;
  /** Seconds left in the finish phase. */
  finishLeft: number;
  satellites: SatelliteFate[];
  /** Stars awarded at the end. */
  stars: Stars;
}

const RAD = Math.PI / 180;
const lerp = (range: readonly [number, number], f: number): number => range[0] + (range[1] - range[0]) * f;

/** The attitude error's size in degrees. */
export function tiltOf(s: DeployState): number {
  return Math.hypot(s.x, s.y);
}

/**
 * The attitude error's two parts in degrees in the stick's frame, for a camera swung `yaw` radians from its resting
 * place: `right` towards the screen's right, `away` away from the camera. Their length is the whole error.
 */
export function screenTiltOf(s: DeployState, yaw: number): { right: number; away: number } {
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  return { right: s.x * c + s.y * n, away: -s.x * n + s.y * c };
}

/** The turn a stick deflection asks for, in the simulation's axes, for a camera swung `yaw` radians from its resting place. */
export function stickTurn(stickX: number, stickY: number, yaw: number): { x: number; y: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: stickX * c - stickY * s, y: stickX * s + stickY * c };
}

/** Satellites released well so far. */
export function goodCount(s: DeployState): number {
  return s.satellites.filter((f) => f === 'good').length;
}

/** Share of the release window left, 1 until it opens down to 0 when it closes. */
export function windowShare(s: DeployState): number {
  return Math.max(0, Math.min(1, s.windowLeft / DEPLOY.windowSeconds));
}

/** Stars for `good` satellites released well. */
export function starsFor(good: number): Stars {
  if (good >= DEPLOY.satellites) return 3;
  if (good >= 3) return 2;
  if (good >= 1) return 1;
  return 0;
}

/** A fresh run with the ship steady and every satellite aboard. */
export function createDeploy(random: () => number): DeployState {
  return {
    phase: 'intro',
    t: 0,
    x: 0,
    y: 0,
    driftAngle: random() * 2 * Math.PI,
    driftRate: lerp(DEPLOY.driftRate, random()),
    driftTurn: 0,
    driftLeft: 0,
    kickX: 0,
    kickY: 0,
    recoil: random() < 0.5 ? 0 : Math.PI,
    reload: 0,
    windowLeft: DEPLOY.windowSeconds,
    finishLeft: DEPLOY.finishSeconds,
    satellites: Array.from({ length: DEPLOY.satellites }, () => 'aboard' as SatelliteFate),
    stars: 0,
  };
}

/**
 * Advances the run by `dt` seconds; `confirm` is a flip of the switch in this step and `yaw` the camera's swing from its
 * resting place in radians. Returns what happened, in order.
 */
export function stepDeploy(s: DeployState, dt: number, input: InputState, confirm: boolean, yaw: number, random: () => number): DeployEvent[] {
  const events: DeployEvent[] = [];
  s.t += dt;
  switch (s.phase) {
    case 'intro':
      if (s.t >= DEPLOY.introSeconds) {
        s.phase = 'window';
        events.push({ kind: 'open' });
      }
      break;
    case 'window':
      if (confirm && s.reload <= 0) release(s, random, events);
      s.reload = Math.max(0, s.reload - dt);
      stepAttitude(s, dt, input, yaw, random);
      s.windowLeft -= dt;
      if (s.phase === 'window' && s.windowLeft <= 0) {
        s.windowLeft = 0;
        let lost = 0;
        s.satellites.forEach((f, i) => {
          if (f !== 'aboard') return;
          s.satellites[i] = 'lost';
          lost++;
        });
        events.push({ kind: 'closed', lost });
        s.phase = 'finish';
      }
      break;
    case 'finish':
      stepAttitude(s, dt, input, yaw, random);
      s.finishLeft -= dt;
      if (s.finishLeft <= 0) {
        s.phase = 'done';
        s.stars = starsFor(goodCount(s));
        events.push({ kind: 'complete', stars: s.stars, good: goodCount(s) });
      }
      break;
    case 'done':
      break;
  }
  return events;
}

/** Turns the ship by the drift, the fading kicks and the stick, and keeps the error within `maxTilt`. Drift and kicks act towards or away from the camera only by `depthShare`. */
function stepAttitude(s: DeployState, dt: number, input: InputState, yaw: number, random: () => number): void {
  s.driftLeft -= dt;
  if (s.driftLeft <= 0) {
    s.driftLeft = lerp(DEPLOY.driftChange, random());
    s.driftTurn = (random() * 2 - 1) * DEPLOY.driftTurn * RAD;
  }
  s.driftAngle += s.driftTurn * dt;
  const stick = stickTurn(input.stickX, input.stickY, yaw);
  s.x += (Math.cos(s.driftAngle) * s.driftRate + s.kickX + stick.x * DEPLOY.stickRate) * dt;
  s.y += (Math.sin(s.driftAngle) * s.driftRate * DEPLOY.depthShare + s.kickY + stick.y * DEPLOY.stickRate) * dt;
  const fade = Math.exp(-dt / DEPLOY.kickSeconds);
  s.kickX *= fade;
  s.kickY *= fade;
  const tilt = tiltOf(s);
  if (tilt > DEPLOY.maxTilt) {
    s.x *= DEPLOY.maxTilt / tilt;
    s.y *= DEPLOY.maxTilt / tilt;
  }
}

/** Releases the next satellite, good with the error at or inside the release limit as last shown, and kicks the ship. */
function release(s: DeployState, random: () => number, events: DeployEvent[]): void {
  const index = s.satellites.indexOf('aboard');
  if (index < 0) return;
  const good = tiltOf(s) <= DEPLOY.releaseLimit;
  s.satellites[index] = good ? 'good' : 'bad';
  s.reload = DEPLOY.reloadSeconds;
  const a = s.recoil + (random() * 2 - 1) * DEPLOY.kickSpread * RAD;
  const rate = DEPLOY.kick / DEPLOY.kickSeconds;
  s.kickX += Math.cos(a) * rate;
  s.kickY += Math.sin(a) * rate * DEPLOY.depthShare;
  events.push({ kind: 'release', index, good });
  if (index === s.satellites.length - 1) s.phase = 'finish';
}
