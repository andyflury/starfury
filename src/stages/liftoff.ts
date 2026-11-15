import { Quaternion, Vector3 } from 'three';
import { LIFTOFF } from '../tuning.ts';
import type { HintIcon, LineId, Stage, StageFactory, StageResult } from '../types.ts';
import { createLiftoff, type LiftoffEvent, type LiftoffSite, type LiftoffState, poseOf, screenTiltOf, stepLiftoff } from './liftoffSim.ts';

/** Camera distance from the stack on the pad, and the fraction of it left after the countdown's push-in. */
const PAD_DISTANCE = 240;
const PUSH_IN = 0.82;
/** Camera distance added per metre of altitude. */
const PULL_BACK = 0.55;
/** The camera's bearing from the stack, radians from +Z towards +X. */
const CAMERA_YAW = 0.55;
/** How far left of the stack the camera looks on the pad, per metre of distance, so the stack stands right of the hint. */
const LOOK_SHIFT = 0.36;
/** Height the camera looks at, as a fraction of the stack's height. */
const LOOK_HEIGHT = 0.42;
/** Rate per second at which the look shift eases to the centred climb view. */
const SHIFT_RATE = 1.2;
/** Steady camera shake at full throttle, 0 to 1. */
const ENGINE_SHAKE = 0.07;
/** Altitudes over which the pad steam fades out. */
const STEAM_FADE: readonly [number, number] = [60, 320];
/** Seconds after an ending's voice line before the result is set. */
const END_PAUSE = 0.5;

const UP = new Vector3(0, 1, 0);
/** Towards the camera and right on screen, on the ground. */
const BACK = new Vector3(Math.sin(CAMERA_YAW), 0, Math.cos(CAMERA_YAW));
const RIGHT = new Vector3(Math.cos(CAMERA_YAW), 0, -Math.sin(CAMERA_YAW));

/** Stage 1: arm, throttle down, countdown, ignition and the climb past the tower, run by `liftoffSim`. */
export const createLiftoffStage: StageFactory = (app) => {
  const { world, effects, hud, input, voice, sfx, camera } = app;
  const { booster, ship } = world;
  const height = booster.height + ship.height;
  const base = new Vector3();
  const look = new Vector3();
  const axis = new Vector3();
  const tilt = new Quaternion();
  const site: LiftoffSite = {
    padY: world.padPoint.y,
    yaw: CAMERA_YAW,
    length: height,
    radius: booster.radius,
    tower: world.tower.footprint,
  };

  let sim: LiftoffState = createLiftoff(false, site);
  let ending: { left: number; result: StageResult } | undefined;
  /** Current look shift. */
  let shift = LOOK_SHIFT;
  let result: StageResult | undefined;

  /** Places the camera on its bearing from the stack, closer during the countdown and further back as it climbs. */
  const placeCamera = (s: LiftoffState): void => {
    const push = Math.min(1, s.countT / LIFTOFF.countdownFrom);
    const ease = push * push * (3 - 2 * push);
    const dist = PAD_DISTANCE * (1 - (1 - PUSH_IN) * ease) + s.altitude * PULL_BACK;
    look.set(base.x, base.y + height * LOOK_HEIGHT, base.z);
    camera.position.copy(look).addScaledVector(BACK, dist);
    camera.position.y = base.y + height * 0.15 + Math.min(s.altitude, 150) * 0.15;
    camera.lookAt(look.addScaledVector(RIGHT, -dist * shift));
  };

  /** Copies the simulation's pose onto the stacked vehicles. */
  const placeVehicles = (s: LiftoffState): void => {
    const pose = poseOf(s);
    base.set(pose.base.x, pose.base.y, pose.base.z);
    tilt.setFromUnitVectors(UP, axis.set(pose.axis.x, pose.axis.y, pose.axis.z));
    booster.object.position.copy(base);
    booster.object.quaternion.copy(tilt);
    ship.object.position.copy(UP).applyQuaternion(tilt).multiplyScalar(booster.height).add(base);
    ship.object.quaternion.copy(tilt);
  };

  const enginesOff = (): void => {
    booster.setEnginesLit(0);
    effects.setExhaust(booster, 0);
    sfx.setEngine(0);
  };

  const end = (r: StageResult): void => {
    hud.clear();
    ending = { left: END_PAUSE, result: r };
  };

  const handle = (e: LiftoffEvent): void => {
    switch (e.kind) {
      case 'prompt':
        void voice.say(e.line);
        break;
      case 'count':
        void voice.say(`count_${e.n}` as LineId);
        sfx.tick();
        break;
      case 'ignition':
        void voice.say('ignition');
        break;
      case 'liftoff':
        void voice.say('liftoff');
        break;
      case 'tiltWarning':
        if (!voice.speaking) void voice.say('tilt_warning');
        break;
      case 'towerClear':
        void voice.queue('tower_clear');
        break;
      case 'falseStart':
        sfx.fail();
        void voice.say('false_start');
        end({ outcome: 'fail', stars: 0 });
        break;
      case 'lowThrust':
        enginesOff();
        sfx.fail();
        void voice.say('low_thrust');
        end({ outcome: 'fail', stars: 0 });
        break;
      case 'crash': {
        effects.explode(new Vector3(e.at.x, e.at.y, e.at.z));
        booster.object.visible = false;
        ship.object.visible = false;
        enginesOff();
        effects.shake(1);
        sfx.explosion();
        void voice.say('crash_rocket');
        end({ outcome: 'fail', stars: 0 });
        break;
      }
      case 'complete':
        end({ outcome: 'success', stars: e.stars });
        break;
    }
  };

  /** The controller hint for the phase; none from liftoff on. */
  const hintFor = (s: LiftoffState): HintIcon | undefined => {
    switch (s.phase) {
      case 'disarm':
        return 'arm-off';
      case 'arm':
        return 'arm-on';
      case 'throttleDown':
        return 'throttle-down';
      case 'ignition':
        return 'throttle-up';
      default:
        return undefined;
    }
  };

  /** Sets the HUD, engines, exhaust, steam, sound and shake from the state and the throttle. */
  const present = (s: LiftoffState, dt: number): void => {
    const throttle = input.state.throttle;
    hud.setHint(hintFor(s));
    shift += ((s.phase === 'climb' ? 0 : LOOK_SHIFT) - shift) * Math.min(1, SHIFT_RATE * dt);
    hud.setCountdown(s.digit);
    const burning = s.phase === 'ignition' || s.phase === 'climb' || s.phase === 'complete';
    if (s.phase === 'throttleDown') hud.setThrottle(throttle);
    else if (s.phase === 'ignition' || s.phase === 'climb') hud.setThrottle(throttle, LIFTOFF.liftoffBand);
    else hud.setThrottle(undefined);
    if (s.phase === 'climb') {
      const { right, away } = screenTiltOf(s);
      hud.setTilt(right, away, LIFTOFF.crashTilt * LIFTOFF.warnFraction, LIFTOFF.crashTilt);
    } else hud.setTilt(undefined);
    const fade = Math.min(1, Math.max(0, (s.altitude - STEAM_FADE[0]) / (STEAM_FADE[1] - STEAM_FADE[0])));
    effects.setPadSteam(s.steam * (1 - fade));
    if (!burning) return;
    booster.setEnginesLit(Math.round(throttle * booster.engineCount));
    effects.setExhaust(booster, throttle);
    sfx.setEngine(throttle);
    effects.shake(ENGINE_SHAKE * throttle * 3.5 * dt * Math.max(0.3, 1 - s.altitude / 400));
  };

  return {
    scored: true,
    start() {
      sim = createLiftoff(input.state.armed, site);
      ending = undefined;
      shift = LOOK_SHIFT;
      result = undefined;
      voice.stop();
      world.resetToPad();
      effects.clear();
      hud.clear();
      sfx.setEngine(0);
      placeVehicles(sim);
      placeCamera(sim);
    },
    update(dt) {
      if (ending) {
        if (sim.phase === 'complete') stepLiftoff(sim, dt, input.state, Math.random);
        placeVehicles(sim);
        placeCamera(sim);
        if (!voice.speaking) ending.left -= dt;
        if (ending.left <= 0) result = ending.result;
        return;
      }
      for (const e of stepLiftoff(sim, dt, input.state, Math.random)) handle(e);
      placeVehicles(sim);
      placeCamera(sim);
      if (!ending) present(sim, dt);
    },
    result: () => result,
    stop() {
      hud.clear();
      effects.clear();
      sfx.setEngine(0);
      booster.setEnginesLit(0);
      ship.setEnginesLit(0);
    },
  } satisfies Stage;
};
