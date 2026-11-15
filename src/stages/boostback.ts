import { Vector3 } from 'three';
import type { Stage, StageFactory, Vehicle } from '../types.ts';

/** Seconds from the start. */
const LINE = 0.3;
const FLIP: readonly [number, number] = [0.8, 3];
const BURN: readonly [number, number] = [3, 6];
const UPRIGHT: readonly [number, number] = [6, 8.5];
const END = 9;
/** Height of the booster's base at the start, and the gap from its top to the ship's base. */
const START_HEIGHT = 1500;
const START_GAP = 20;
/** Speed of both vehicles straight up at the start, m/s, and the ship's extra speed away from the booster. */
const START_SPEED = 60;
const SHIP_LEAD = 15;
/** Sky altitude at the start; it sinks to 0 by the end. */
const SKY_START = 0.65;
/** Lean of the booster during the boostback burn, degrees: nose towards -X, a little above the horizon. */
const BOOST_LEAN = -70;
const GRAVITY = 9.8;
/** Ship acceleration and booster acceleration in the boostback burn, m/s². */
const SHIP_ACCEL = 12;
const BOOST_ACCEL = 16;
/** Engines lit in the boostback burn. */
const BURN_ENGINES = 13;

const smooth = (t: number, [a, b]: readonly [number, number]): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** A vehicle's flight: base position, velocity and lean towards +X in degrees. */
interface Flight {
  readonly v: Vehicle;
  readonly pos: Vector3;
  readonly vel: Vector3;
  lean: number;
}

/**
 * The unscored cutscene after hot staging, about 9 s: the ship flies on above, the booster flips, burns back towards
 * the site and ends falling engines-first while the sky brightens to the ground's. The camera stays with the booster.
 */
export const createBoostback: StageFactory = (app) => {
  const { world, effects, voice, sfx, camera } = app;
  const { booster, ship } = world;
  const b: Flight = { v: booster, pos: new Vector3(), vel: new Vector3(), lean: 0 };
  const s: Flight = { v: ship, pos: new Vector3(), vel: new Vector3(), lean: 0 };
  const nose = new Vector3();
  const offset = new Vector3();
  const look = new Vector3();
  const Z = new Vector3(0, 0, -1);
  let t = 0;
  let spoke = false;

  const noseOf = (f: Flight, out: Vector3): Vector3 => {
    const a = (f.lean * Math.PI) / 180;
    return out.set(Math.sin(a), Math.cos(a), 0);
  };

  const place = (f: Flight): void => {
    f.v.object.position.copy(f.pos);
    f.v.object.quaternion.setFromAxisAngle(Z, (f.lean * Math.PI) / 180);
  };

  /** Places the camera beside the booster's top, then its middle, then above it looking down at the site. */
  const aim = (): void => {
    const high = smooth(t, UPRIGHT);
    look.copy(noseOf(b, nose).multiplyScalar(booster.height * (0.9 - 0.4 * smooth(t, FLIP)))).add(b.pos);
    offset.set(70 - 20 * high, 15 + 235 * high, 200 - 80 * high);
    camera.position.copy(look).add(offset);
    camera.lookAt(look);
  };

  const fly = (f: Flight, accel: number, dt: number): void => {
    noseOf(f, nose);
    f.vel.x += nose.x * accel * dt;
    f.vel.y += (nose.y * accel - GRAVITY) * dt;
    f.pos.addScaledVector(f.vel, dt);
  };

  return {
    scored: false,
    start() {
      t = 0;
      spoke = false;
      world.resetToPad();
      world.setSkyAltitude(SKY_START);
      effects.clear();
      app.hud.clear();
      b.lean = 0;
      b.pos.set(world.padPoint.x, START_HEIGHT, world.padPoint.z);
      b.vel.set(0, START_SPEED, 0);
      s.lean = 0;
      s.pos.set(world.padPoint.x, START_HEIGHT + booster.height + START_GAP, world.padPoint.z);
      s.vel.set(0, START_SPEED + SHIP_LEAD, 0);
      place(b);
      place(s);
      ship.setEnginesLit(ship.engineCount);
      effects.setExhaust(ship, 1);
      sfx.setEngine(0.6);
      aim();
    },
    update(dt) {
      t += dt;
      if (!spoke && t >= LINE) {
        spoke = true;
        void voice.say('staging');
      }
      fly(s, SHIP_ACCEL + GRAVITY, dt);
      const burning = t >= BURN[0] && t < BURN[1];
      fly(b, burning ? BOOST_ACCEL : 0, dt);
      b.lean = t < BURN[1] ? BOOST_LEAN * smooth(t, FLIP) : BOOST_LEAN * (1 - smooth(t, UPRIGHT));
      booster.setEnginesLit(burning ? BURN_ENGINES : 0);
      effects.setExhaust(booster, burning ? Math.min(1, (t - BURN[0]) * 2) : 0);
      sfx.setEngine(burning ? 0.8 : Math.max(0, 0.6 - t * 0.3));
      world.setSkyAltitude(SKY_START * (1 - smooth(t, [0, END])));
      place(b);
      place(s);
      aim();
    },
    result: () => (t >= END ? { outcome: 'success', stars: 0 } : undefined),
    stop() {
      effects.clear();
      sfx.setEngine(0);
      world.resetToPad();
    },
  } satisfies Stage;
};
