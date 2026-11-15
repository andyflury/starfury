import { Matrix4, Vector3 } from 'three';
import { REENTRY } from '../tuning.ts';
import type { Stage, StageFactory, StageResult } from '../types.ts';
import { attitudeOf, createReentry, intensityAt, type ReentryEvent, type ReentryState, stepReentry } from './reentrySim.ts';

const DEG = Math.PI / 180;
/** The air comes from straight below: the ship falls belly-first. */
const FROM = new Vector3(0, -1, 0);

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Re-entry: the player holds StarFury's heat shield against the plasma with the right stick, run by `reentrySim`.
 * Stick right rolls right, pushed forward lowers the nose, pulled back raises it; the tilt level's dot shows roll to
 * the right and nose-down upwards, so the stick moves the dot its own way.
 */
export const createReentryStage: StageFactory = (app) => {
  const { world, effects, hud, input, voice, sfx, camera } = app;
  const { ship, booster } = world;
  const nose = new Vector3();
  const right = new Vector3();
  const back = new Vector3();
  const basis = new Matrix4();
  const offset = new Vector3();
  let sim: ReentryState = createReentry();
  let forward = 0;
  let aft = 0;
  let ending: { left: number; result: StageResult } | undefined;
  let result: StageResult | undefined;

  /** Turns the ship to the simulation's attitude, its centre at the origin; the ship's belly is its local -Z. */
  const placeShip = (s: ReentryState): void => {
    const a = attitudeOf(s);
    nose.set(a.nose.x, a.nose.y, a.nose.z);
    right.set(a.right.x, a.right.y, a.right.z);
    back.set(-a.belly.x, -a.belly.y, -a.belly.z);
    ship.object.quaternion.setFromRotationMatrix(basis.makeBasis(right, nose, back));
    ship.object.position.copy(nose).multiplyScalar(-ship.height / 2);
  };

  /** Beside the ship on its +X side and a little above, on a slowly swaying bearing, looking a little below its centre. */
  const placeCamera = (s: ReentryState): void => {
    const bearing = (REENTRY.cameraBearing + REENTRY.cameraSway * Math.sin((2 * Math.PI * s.t) / REENTRY.cameraSwayPeriod)) * DEG;
    const el = REENTRY.cameraElevation * DEG;
    offset.set(Math.cos(el) * Math.cos(bearing), Math.sin(el), Math.cos(el) * Math.sin(bearing)).multiplyScalar(REENTRY.cameraDistance);
    camera.position.copy(offset);
    camera.lookAt(0, -REENTRY.cameraLookBelow, 0);
  };

  /** Moves the flaps towards the pitch stick: pulled back spreads the forward pair, pushed forward the aft pair. */
  const moveFlaps = (dt: number): void => {
    const pitch = clamp1(input.state.stickY);
    const k = Math.min(1, REENTRY.flapRate * dt);
    forward += (-REENTRY.flapTravel * pitch - forward) * k;
    aft += (REENTRY.flapTravel * pitch - aft) * k;
    ship.setFlaps(forward, aft);
  };

  const quiet = (): void => {
    effects.setPlasma(ship, 0, FROM);
    sfx.setEngine(0);
  };

  const end = (r: StageResult): void => {
    hud.clear();
    ending = { left: REENTRY.endPause, result: r };
  };

  const handle = (e: ReentryEvent): void => {
    switch (e.kind) {
      case 'hot':
        if (!voice.speaking) void voice.say('reentry_hot');
        break;
      case 'burnup':
        quiet();
        effects.explode(new Vector3());
        ship.object.visible = false;
        effects.shake(1);
        sfx.explosion();
        void voice.say('crash_ship');
        end({ outcome: 'fail', stars: 0 });
        break;
      case 'complete':
        quiet();
        void voice.say('reentry_done');
        end({ outcome: 'success', stars: e.stars });
        break;
    }
  };

  /** Sets the plasma, roar, shake and HUD from the state. */
  const present = (s: ReentryState, dt: number): void => {
    const intensity = intensityAt(s.t);
    effects.setPlasma(ship, intensity, FROM);
    sfx.setEngine(REENTRY.roar * intensity);
    effects.shake(REENTRY.shake * intensity * dt);
    hud.setHeat(s.heat);
    hud.setTilt(s.roll, s.pitch, REENTRY.limit, REENTRY.maxError);
  };

  return {
    scored: true,
    start() {
      sim = createReentry();
      forward = 0;
      aft = 0;
      ending = undefined;
      result = undefined;
      voice.stop();
      world.setEnvironment('orbit');
      effects.clear();
      hud.clear();
      sfx.setEngine(0);
      booster.object.visible = false;
      booster.setEnginesLit(0);
      ship.object.visible = true;
      ship.setEnginesLit(0);
      ship.setPayloadDoor(0);
      ship.setFlaps(0, 0);
      placeShip(sim);
      placeCamera(sim);
      present(sim, 0);
      void voice.say('reentry_intro');
      void voice.queue('reentry_how');
    },
    update(dt) {
      if (ending) {
        if (!voice.speaking) ending.left -= dt;
        if (ending.left <= 0) result = ending.result;
        return;
      }
      for (const e of stepReentry(sim, dt, input.state, Math.random)) handle(e);
      placeShip(sim);
      placeCamera(sim);
      moveFlaps(dt);
      if (!ending) present(sim, dt);
    },
    result: () => result,
    stop() {
      hud.clear();
      effects.clear();
      sfx.setEngine(0);
      world.resetToPad();
    },
  } satisfies Stage;
};
