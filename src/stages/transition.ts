import { AdditiveBlending, CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { Stage, StageFactory, Vehicle } from '../types.ts';

/** Seconds from the start. */
const STAGING_LINE = 0.3;
const SEPARATE = 3.5;
const BOOSTER_CUTOFF = 4.6;
const FLIP: readonly [number, number] = [5, 8];
const BURN: readonly [number, number] = [8, 12];
const UPRIGHT: readonly [number, number] = [12, 14.5];
const END = 15;
/** Height of the booster's base at the start. */
const START_HEIGHT = 600;
/** Speed of the stack along its axis before separation, m/s. */
const STACK_SPEED = 60;
/** Lean of the stack towards +X, degrees, reached at separation. */
const STACK_LEAN = 25;
/** Lean of the booster during the boostback burn, degrees: nose towards -X, a little above the horizon. */
const BOOST_LEAN = -70;
const GRAVITY = 9.8;
/** Ship acceleration after separation and booster acceleration in the boostback burn, m/s². */
const SHIP_ACCEL = 22;
const BOOST_ACCEL = 16;
/** Flash size in metres and seconds to fade. */
const FLASH_SIZE = 70;
const FLASH_FADE = 0.7;

const smooth = (t: number, [a, b]: readonly [number, number]): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** A soft white-orange disc on a transparent canvas. */
function flashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,220,150,0.8)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A vehicle's flight: base position, velocity and lean towards +X in degrees. */
interface Flight {
  readonly v: Vehicle;
  readonly pos: Vector3;
  readonly vel: Vector3;
  lean: number;
}

/**
 * The unscored cutscene between the stages, about 15 s: the stack climbs, hot staging, the ship flies on, the booster
 * flips, burns back towards the site and ends falling engines-first. The camera stays with the booster.
 */
export const createTransition: StageFactory = (app) => {
  const { world, effects, voice, sfx, camera, scene } = app;
  const { booster, ship } = world;
  const flash = new Sprite(new SpriteMaterial({ map: flashTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  const b: Flight = { v: booster, pos: new Vector3(), vel: new Vector3(), lean: 0 };
  const s: Flight = { v: ship, pos: new Vector3(), vel: new Vector3(), lean: 0 };
  const nose = new Vector3();
  const offset = new Vector3();
  const look = new Vector3();
  const Z = new Vector3(0, 0, -1);
  let t = 0;
  let spoke = false;
  let separated = false;

  const noseOf = (f: Flight, out: Vector3): Vector3 => {
    const a = (f.lean * Math.PI) / 180;
    return out.set(Math.sin(a), Math.cos(a), 0);
  };

  const place = (f: Flight): void => {
    f.v.object.position.copy(f.pos);
    f.v.object.quaternion.setFromAxisAngle(Z, (f.lean * Math.PI) / 180);
  };

  /** Puts the ship on top of the booster. */
  const stack = (): void => {
    s.lean = b.lean;
    s.pos.copy(noseOf(b, nose).multiplyScalar(booster.height).add(b.pos));
    s.vel.copy(b.vel);
  };

  /** Places the camera beside the stack, then beside the booster, then above the booster looking down at the site. */
  const aim = (): void => {
    const sep = smooth(t, [SEPARATE, SEPARATE + 2]);
    const high = smooth(t, UPRIGHT);
    look.copy(noseOf(b, nose).multiplyScalar(booster.height * (0.85 - 0.35 * sep)).add(b.pos));
    offset.set(70 - 20 * high, 15 + 235 * high, 260 - 60 * sep - 80 * high);
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
      separated = false;
      world.resetToPad();
      effects.clear();
      app.hud.clear();
      b.lean = 0;
      b.pos.set(world.padPoint.x, START_HEIGHT, world.padPoint.z);
      b.vel.set(0, STACK_SPEED, 0);
      stack();
      place(b);
      place(s);
      booster.setEnginesLit(booster.engineCount);
      effects.setExhaust(booster, 1);
      sfx.setEngine(1);
      flash.visible = false;
      flash.scale.setScalar(FLASH_SIZE);
      scene.add(flash);
      aim();
    },
    update(dt) {
      t += dt;
      if (!spoke && t >= STAGING_LINE) {
        spoke = true;
        void voice.say('staging');
      }
      if (!separated) {
        b.lean = STACK_LEAN * smooth(t, [0, SEPARATE]);
        noseOf(b, nose);
        b.vel.copy(nose).multiplyScalar(STACK_SPEED);
        b.pos.addScaledVector(b.vel, dt);
        stack();
        if (t >= SEPARATE) {
          separated = true;
          ship.setEnginesLit(ship.engineCount);
          effects.setExhaust(ship, 1);
          booster.setEnginesLit(3);
          effects.setExhaust(booster, 0.25);
          flash.position.copy(s.pos);
          flash.visible = true;
          effects.shake(0.35);
        }
      } else {
        fly(s, SHIP_ACCEL + GRAVITY * noseOf(s, nose).y, dt);
        s.lean = Math.min(STACK_LEAN + 10, s.lean + dt * 2);
        const burning = t >= BURN[0] && t < BURN[1];
        fly(b, burning ? BOOST_ACCEL : 0, dt);
        b.lean = t < BURN[1] ? STACK_LEAN + (BOOST_LEAN - STACK_LEAN) * smooth(t, FLIP) : BOOST_LEAN * (1 - smooth(t, UPRIGHT));
        if (t >= BOOSTER_CUTOFF && t < BURN[0]) {
          booster.setEnginesLit(0);
          effects.setExhaust(booster, 0);
        } else if (burning) {
          booster.setEnginesLit(13);
          effects.setExhaust(booster, Math.min(1, (t - BURN[0]) * 2));
        } else if (t >= BURN[1]) {
          booster.setEnginesLit(0);
          effects.setExhaust(booster, 0);
        }
        sfx.setEngine(burning ? 0.8 : Math.max(0, 0.6 - (t - SEPARATE) * 0.3));
        const age = t - SEPARATE;
        const m = flash.material;
        m.opacity = Math.max(0, 1 - age / FLASH_FADE);
        flash.visible = m.opacity > 0;
        flash.scale.setScalar(FLASH_SIZE * (1 + age * 1.5));
      }
      place(b);
      place(s);
      aim();
    },
    result: () => (t >= END ? { outcome: 'success', stars: 0 } : undefined),
    stop() {
      flash.removeFromParent();
      effects.clear();
      sfx.setEngine(0);
      world.resetToPad();
    },
  } satisfies Stage;
};
