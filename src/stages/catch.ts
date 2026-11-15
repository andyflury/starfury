import { AdditiveBlending, Color, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3 } from 'three';
import { CATCH } from '../tuning.ts';
import type { LineId, Stage, StageFactory, StageResult } from '../types.ts';
import { SHIP_TUNING, createCatchSim, flipEase, hullAxis, hullBase, inCatchBox, screenStick } from './catchSim.ts';
import type { CatchEvent, CatchGeometry, CatchSim, CatchTuning } from './catchSim.ts';

const RING_RADIUS = 6;
const RING_TUBE = 0.6;
const TARGET_COLOR = new Color(0x4fe3ff);
const IN_BOX_COLOR = new Color(0x4dff7a);
const DEG = Math.PI / 180;
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
const UPRIGHT = new Quaternion();

/**
 * What a catch stage catches: the vehicle, the arm carriage's height for it, its tunables, how many engines light at low
 * and high throttle, and its lines.
 */
interface CatchSpec {
  readonly vehicle: 'booster' | 'ship';
  readonly armHeight: number;
  readonly tuning: CatchTuning;
  readonly lit: readonly [number, number];
  readonly intro: readonly LineId[];
  readonly caught: LineId;
  /** The line spoken when the vehicle is lost. */
  readonly crashed: LineId;
}

const glow = (opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: TARGET_COLOR, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });

/**
 * The target, placed at the catch point by the stage: a pulsing ring with a ripple, green while the vehicle is over the
 * catch box. Beyond `ringScaleDistance` from the camera it grows with distance so it keeps its size on screen.
 */
function createTarget(): { group: Group; update(t: number, cameraDistance: number, inBox: boolean): void } {
  const group = new Group();
  group.name = 'catch-target';
  const ringMat = glow(1);
  const ring = new Mesh(new TorusGeometry(RING_RADIUS, RING_TUBE, 12, 72), ringMat);
  ring.rotation.x = Math.PI / 2;
  const rippleMat = glow(0.7);
  const ripple = new Mesh(new TorusGeometry(RING_RADIUS, RING_TUBE * 0.6, 8, 72), rippleMat);
  ripple.rotation.x = Math.PI / 2;
  group.add(ring, ripple);

  return {
    group,
    update(t, cameraDistance, inBox) {
      const color = inBox ? IN_BOX_COLOR : TARGET_COLOR;
      ringMat.color.copy(color);
      rippleMat.color.copy(color);
      group.scale.setScalar(Math.max(1, cameraDistance / CATCH.ringScaleDistance));
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ring.scale.setScalar(1 + 0.08 * pulse);
      ringMat.opacity = 0.75 + 0.25 * pulse;
      const r = (t * 0.7) % 1;
      ripple.scale.setScalar(1 + 1.6 * r);
      rippleMat.opacity = 0.8 * (1 - r);
    },
  };
}

const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** A stage in which the player brings `spec.vehicle` down between the chopsticks. */
function createCatchStage(spec: CatchSpec): StageFactory {
  return (app) => {
    const { scene, camera, world, effects, input, voice, sfx, hud } = app;
    const { tower } = world;
    const c = spec.tuning;
    const vehicle = spec.vehicle === 'ship' ? world.ship : world.booster;
    const hidden = spec.vehicle === 'ship' ? world.booster : world.ship;
    /** Reads the world's measurements; valid once the carriage is at `spec.armHeight`. */
    const measure = (): CatchGeometry => ({
      catchY: tower.catchPoint.y,
      catchHalfWidth: tower.catchHalfWidth,
      pinHeight: vehicle.catchPinHeight,
      radius: vehicle.radius,
      height: vehicle.height,
      mountTop: world.padPoint.y,
      mountRadius: world.mountRadius,
      arms: tower.arms,
      footprint: tower.footprint,
    });
    let geo = measure();
    const target = createTarget();
    const caughtAt = new Vector3();
    /** Belly down with the nose towards -Z; the heading turn about +Y brings the nose to -X. */
    const bellyQ = new Quaternion().setFromUnitVectors(world.ship.belly, DOWN);
    const flipQ = new Quaternion();
    const headingQ = new Quaternion();
    const tiltQ = new Quaternion();
    const axis = new Vector3();
    const camEuler = new Euler(0, 0, 0, 'YXZ');
    const chase = new Vector3();
    const drone = new Vector3();
    const centre = new Vector3();
    const hullUp = new Vector3();

    let sim: CatchSim;
    let run = 0;
    let elapsed = 0;
    /** Seconds the drone view has been swinging; it advances only while the drone view is blended in. */
    let swing = 0;
    /** The camera's turn about +Y from facing -Z, radians; the stick is read relative to it. */
    let yaw = 0;
    let ending: { kind: 'caught'; hard: boolean; t: number; startPos: Vector3; startQ: Quaternion } | { kind: 'crash' } | undefined;
    let endResult: StageResult | undefined;
    let endIn: number | undefined;
    let result: StageResult | undefined;

    /** Speaks an outcome line, then sets `result` `endPause` seconds after it ends. */
    const finish = (line: LineId, r: StageResult): void => {
      const mine = run;
      endResult = r;
      hud.clear();
      vehicle.setEnginesLit(0);
      effects.setExhaust(vehicle, 0);
      sfx.setEngine(0);
      void voice.say(line).then(() => {
        if (mine === run) endIn = c.endPause;
      });
    };

    const handle = (e: CatchEvent): void => {
      if (e.type === 'lowFuel') void voice.queue('low_fuel');
      else if (e.type === 'fuelEmpty') void voice.queue('fuel_empty');
      else if (e.type === 'slower' || e.type === 'descend' || e.type === 'flipNow') {
        if (!voice.speaking) void voice.say(e.type === 'flipNow' ? 'ship_flip' : e.type);
      } else if (e.type === 'caught') {
        ending = { kind: 'caught', hard: e.hard, t: 0, startPos: vehicle.object.position.clone(), startQ: vehicle.object.quaternion.clone() };
        sfx.clank();
        if (e.hard) effects.shake(c.hardShake);
        finish(e.hard ? 'caught_hard' : spec.caught, { outcome: 'success', stars: e.stars });
      } else {
        ending = { kind: 'crash' };
        effects.explode(new Vector3(e.at.x, e.at.y, e.at.z));
        vehicle.object.visible = false;
        effects.shake(1);
        sfx.explosion();
        finish(spec.crashed, { outcome: 'fail', stars: 0 });
      }
    };

    /**
     * Copies the simulation onto the vehicle: the flip about the hull's middle, the lean towards the direction of travel
     * about the base, the flaps, engines and exhaust.
     */
    const pose = (input: { stickX: number }): void => {
      const s = sim.state;
      const base = hullBase(s, geo.height);
      vehicle.object.position.set(base.x, base.y, base.z);
      const h = Math.hypot(s.vx, s.vz);
      if (h > 1e-6) tiltQ.setFromAxisAngle(axis.set(s.vz / h, 0, -s.vx / h), (s.tilt * Math.PI) / 180);
      else tiltQ.identity();
      vehicle.object.quaternion.copy(tiltQ);
      if (s.flip < 1) {
        const k = flipEase(s.flip);
        headingQ.setFromAxisAngle(UP, (Math.PI / 2) * (1 - k));
        vehicle.object.quaternion.multiply(headingQ).multiply(flipQ.slerpQuaternions(bellyQ, UPRIGHT, k));
      }
      if (c.belly) {
        const k = 1 - flipEase(s.flip);
        const stick = Math.max(-1, Math.min(1, input.stickX)) * c.belly.flapStick;
        world.ship.setFlaps(k * (c.belly.flapSpread + stick), k * (c.belly.flapSpread - stick));
      }
      const [low, high] = spec.lit;
      vehicle.setEnginesLit(s.thrust < c.engineLow ? 0 : s.thrust < c.engineHigh ? low : high);
      effects.setExhaust(vehicle, s.thrust < c.engineLow ? 0 : c.exhaustMin + (1 - c.exhaustMin) * s.thrust);
      sfx.setEngine(s.thrust);
    };

    /**
     * The chase view, facing -Z: behind and above the hull's middle, `height / 2` up, along `chaseElevation`, at the
     * closest distance from which both ends of the hull and the catch point all lie between `chaseBottom` and
     * `chaseTop` on screen and within the side margin. Writes the position into `out` and returns the pitch down.
     */
    const chaseView = (out: Vector3): number => {
      const p = vehicle.object.position;
      const t = tower.catchPoint;
      const points = [
        { x: p.x + hullUp.x * geo.height, y: p.y + hullUp.y * geo.height, z: p.z + hullUp.z * geo.height },
        { x: p.x, y: p.y, z: p.z },
        { x: t.x, y: t.y, z: t.z },
      ];
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = tanV * camera.aspect;
      const above = Math.atan(c.chaseTop * tanV);
      const span = above - Math.atan(c.chaseBottom * tanV);
      const e = c.chaseElevation * DEG;
      const top = { x: centre.x, y: centre.y + geo.height / 2, z: centre.z };
      let pitch = 0;
      /** Places the camera `d` metres from the anchor; false when the points do not fit on screen. */
      const fit = (d: number): boolean => {
        const cy = top.y + d * Math.sin(e);
        const cz = top.z + d * Math.cos(e);
        let lo = Infinity;
        let hi = -Infinity;
        for (const q of points) {
          const down = Math.atan2(cy - q.y, cz - q.z);
          lo = Math.min(lo, down);
          hi = Math.max(hi, down);
        }
        pitch = lo + above;
        const sin = Math.sin(pitch);
        const cos = Math.cos(pitch);
        let left = -Infinity;
        let right = Infinity;
        for (const q of points) {
          const reach = c.chaseSideMargin * tanH * ((cz - q.z) * cos + (cy - q.y) * sin);
          left = Math.max(left, q.x - reach);
          right = Math.min(right, q.x + reach);
        }
        out.set(Math.min(right, Math.max(left, centre.x)), cy, cz);
        return hi - lo <= span && left <= right;
      };
      let near = c.chaseMinDistance;
      if (!fit(near)) {
        let far = near * 2;
        while (!fit(far)) far *= 2;
        for (let i = 0; i < 30; i++) {
          const mid = (near + far) / 2;
          if (fit(mid)) far = mid;
          else near = mid;
        }
        fit(far);
      }
      return pitch;
    };

    /**
     * The drone view: looking down at `droneElevation` at a point between the catch point and the hull's middle, from an
     * angle about the tower's axis that swings, eased, between the +Z side (0) and the +X side (`droneSweep`).
     */
    const droneView = (out: Vector3, h: number): number => {
      const sweep = c.droneSweep * DEG;
      const omega = (2 * c.droneSpeed * DEG) / sweep;
      const angle = (sweep / 2) * (1 - Math.cos(swing * omega));
      const t = tower.catchPoint;
      const aimY = t.y + c.droneAim * (centre.y - t.y);
      const d = c.droneDistance + c.droneDistancePerHeight * h;
      const e = c.droneElevation * DEG;
      out.set(t.x + Math.sin(angle) * d * Math.cos(e), aimY + d * Math.sin(e), t.z + Math.cos(angle) * d * Math.cos(e));
      return angle;
    };

    /** Chase view blending into the drone view on the approach near the tower; sets `yaw`. */
    const placeCamera = (dt: number): void => {
      const p = vehicle.object.position;
      const a = hullAxis(sim.state.flip);
      hullUp.set(a.x, a.y, a.z);
      centre.copy(p).addScaledVector(hullUp, geo.height / 2);
      const h = Math.max(0, centre.y - geo.height / 2 + geo.pinHeight - geo.catchY);
      const chasePitch = chaseView(chase);
      const near = smoothstep((2 * c.droneRadius - Math.hypot(centre.x, centre.z)) / c.droneRadius);
      const w = near * smoothstep((c.approachHeight - h) / (c.approachHeight * 0.4));
      if (w > 0) swing += dt;
      const droneYaw = droneView(drone, h);
      camera.position.lerpVectors(chase, drone, w);
      yaw = droneYaw * w;
      camEuler.set(-(chasePitch + (c.droneElevation * DEG - chasePitch) * w), yaw, 0);
      camera.quaternion.setFromEuler(camEuler);
    };

    const stage: Stage = {
      scored: true,
      start() {
        run++;
        elapsed = 0;
        effects.clear();
        world.resetToPad();
        tower.setArmHeight(spec.armHeight);
        geo = measure();
        target.group.position.copy(tower.catchPoint);
        caughtAt.set(tower.catchPoint.x, tower.catchPoint.y - vehicle.catchPinHeight, tower.catchPoint.z);
        sim = createCatchSim(c, geo, Math.random);
        ending = undefined;
        endResult = undefined;
        endIn = undefined;
        result = undefined;
        hidden.object.visible = false;
        scene.add(target.group);
        swing = 0;
        pose({ stickX: 0 });
        placeCamera(0);
        hud.clear();
        spec.intro.forEach((line, i) => void (i === 0 ? voice.say(line) : voice.queue(line)));
      },
      update(dt) {
        elapsed += dt;
        const s = sim.state;
        const i = input.state;
        const stick = screenStick(i.stickX, i.stickY, yaw);
        if (!ending) for (const e of sim.step(dt, { ...i, ...stick })) handle(e);
        if (!ending) {
          pose(stick);
          hud.setThrottle(i.throttle, c.belly && s.flip === 0 ? c.belly.flipThrottle : undefined);
          hud.setFuel(s.fuel);
          hud.setSpeedLight(s.light);
        } else if (ending.kind === 'caught') {
          ending.t += dt;
          const k = smoothstep(ending.t / c.closeSeconds);
          tower.setChopsticks(k);
          vehicle.object.position.lerpVectors(ending.startPos, caughtAt, k);
          vehicle.object.quaternion.slerpQuaternions(ending.startQ, tiltQ.identity(), k);
        }
        target.group.visible = ending?.kind !== 'caught';
        if (!ending || ending.kind === 'caught') placeCamera(dt);
        target.update(elapsed, camera.position.distanceTo(tower.catchPoint), inCatchBox(c, geo, s.x, s.z));
        if (endIn !== undefined) {
          endIn -= dt;
          if (endIn <= 0) result = endResult;
        }
      },
      result: () => result,
      stop() {
        run++;
        scene.remove(target.group);
        hud.clear();
        effects.clear();
        sfx.setEngine(0);
        world.resetToPad();
      },
    };
    return stage;
  };
}

/** Stage 2: the player brings Super Heavy down between the chopsticks. */
export const createBoosterCatch = createCatchStage({ vehicle: 'booster', armHeight: 0, tuning: CATCH, lit: [3, 13], intro: ['catch_intro', 'catch_steer'], caught: 'caught', crashed: 'crash_booster' });

/** The finale: StarFury falls belly-first, flips upright on its engines and is caught by the chopsticks. */
export const createShipCatch = createCatchStage({ vehicle: 'ship', armHeight: 1, tuning: SHIP_TUNING, lit: [3, 3], intro: ['ship_intro'], caught: 'ship_caught', crashed: 'crash_ship' });
