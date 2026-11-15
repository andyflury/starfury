import { AdditiveBlending, Color, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3 } from 'three';
import { CATCH } from '../tuning.ts';
import type { LineId, Stage, StageFactory, StageResult } from '../types.ts';
import { createCatchSim, inCatchBox, screenStick } from './boosterCatchSim.ts';
import type { CatchEvent, CatchGeometry, CatchSim } from './boosterCatchSim.ts';

const RING_RADIUS = 6;
const RING_TUBE = 0.6;
const LIT_LOW = 3;
const LIT_HIGH = 13;
const TARGET_COLOR = new Color(0x4fe3ff);
const IN_BOX_COLOR = new Color(0x4dff7a);
const DEG = Math.PI / 180;

const glow = (opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: TARGET_COLOR, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });

/**
 * The target: a pulsing ring at the catch point with a ripple, green while the booster is over the catch box. Beyond
 * `ringScaleDistance` from the camera it grows with distance so it keeps its size on screen.
 */
function createTarget(catchPoint: Vector3): { group: Group; update(t: number, cameraDistance: number, inBox: boolean): void } {
  const group = new Group();
  group.name = 'catch-target';
  group.position.copy(catchPoint);
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

/** Stage 2: the player brings Super Heavy down between the chopsticks. */
export const createBoosterCatch: StageFactory = (app) => {
  const { scene, camera, world, effects, input, voice, sfx, hud } = app;
  const { booster, ship, tower } = world;
  const geo: CatchGeometry = {
    catchY: tower.catchPoint.y,
    catchHalfWidth: tower.catchHalfWidth,
    pinHeight: booster.catchPinHeight,
    radius: booster.radius,
    height: booster.height,
    mountTop: world.padPoint.y,
    mountRadius: world.mountRadius,
    arms: tower.arms,
    footprint: tower.footprint,
  };
  const target = createTarget(tower.catchPoint);
  const caughtAt = new Vector3(tower.catchPoint.x, tower.catchPoint.y - booster.catchPinHeight, tower.catchPoint.z);
  const tiltQ = new Quaternion();
  const axis = new Vector3();
  const camEuler = new Euler(0, 0, 0, 'YXZ');
  const chase = new Vector3();
  const drone = new Vector3();

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
    booster.setEnginesLit(0);
    effects.setExhaust(booster, 0);
    sfx.setEngine(0);
    void voice.say(line).then(() => {
      if (mine === run) endIn = CATCH.endPause;
    });
  };

  const handle = (e: CatchEvent): void => {
    if (e.type === 'lowFuel') void voice.queue('low_fuel');
    else if (e.type === 'fuelEmpty') void voice.queue('fuel_empty');
    else if (e.type === 'slower' || e.type === 'descend') {
      if (!voice.speaking) void voice.say(e.type);
    } else if (e.type === 'caught') {
      ending = { kind: 'caught', hard: e.hard, t: 0, startPos: booster.object.position.clone(), startQ: booster.object.quaternion.clone() };
      sfx.clank();
      if (e.hard) effects.shake(CATCH.hardShake);
      finish(e.hard ? 'caught_hard' : 'caught', { outcome: 'success', stars: e.stars });
    } else {
      ending = { kind: 'crash' };
      effects.explode(new Vector3(e.at.x, e.at.y, e.at.z));
      booster.object.visible = false;
      effects.shake(1);
      sfx.explosion();
      finish('crash', { outcome: 'fail', stars: 0 });
    }
  };

  /** Copies the simulation onto the booster: position, lean towards the direction of travel, engines and exhaust. */
  const pose = (): void => {
    const s = sim.state;
    booster.object.position.set(s.x, s.y, s.z);
    const h = Math.hypot(s.vx, s.vz);
    if (h > 1e-6) tiltQ.setFromAxisAngle(axis.set(s.vz / h, 0, -s.vx / h), (s.tilt * Math.PI) / 180);
    else tiltQ.identity();
    booster.object.quaternion.copy(tiltQ);
    booster.setEnginesLit(s.thrust < CATCH.engineLow ? 0 : s.thrust < CATCH.engineHigh ? LIT_LOW : LIT_HIGH);
    effects.setExhaust(booster, s.thrust < CATCH.engineLow ? 0 : CATCH.exhaustMin + (1 - CATCH.exhaustMin) * s.thrust);
    sfx.setEngine(s.thrust);
  };

  /**
   * The chase view, facing -Z: behind and above the booster's top along `chaseElevation`, at the closest distance from
   * which the booster and the catch point all lie between `chaseBottom` and `chaseTop` on screen and within the side
   * margin. Writes the position into `out` and returns the pitch down.
   */
  const chaseView = (out: Vector3): number => {
    const p = booster.object.position;
    const t = tower.catchPoint;
    const points = [
      { x: p.x, y: p.y + geo.height, z: p.z },
      { x: p.x, y: p.y, z: p.z },
      { x: t.x, y: t.y, z: t.z },
    ];
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    const above = Math.atan(CATCH.chaseTop * tanV);
    const span = above - Math.atan(CATCH.chaseBottom * tanV);
    const e = CATCH.chaseElevation * DEG;
    const top = points[0] ?? t;
    let pitch = 0;
    /** Places the camera `d` metres from the booster's top; false when the points do not fit on screen. */
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
        const reach = CATCH.chaseSideMargin * tanH * ((cz - q.z) * cos + (cy - q.y) * sin);
        left = Math.max(left, q.x - reach);
        right = Math.min(right, q.x + reach);
      }
      out.set(Math.min(right, Math.max(left, p.x)), cy, cz);
      return hi - lo <= span && left <= right;
    };
    let near = CATCH.chaseMinDistance;
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
   * The drone view: looking down at `droneElevation` at a point between the catch point and the booster, from an angle
   * about the tower's axis that swings, eased, between the +Z side (0) and the +X side (`droneSweep`).
   */
  const droneView = (out: Vector3, h: number): number => {
    const sweep = CATCH.droneSweep * DEG;
    const omega = (2 * CATCH.droneSpeed * DEG) / sweep;
    const angle = (sweep / 2) * (1 - Math.cos(swing * omega));
    const c = tower.catchPoint;
    const aimY = c.y + CATCH.droneAim * (booster.object.position.y + geo.height / 2 - c.y);
    const d = CATCH.droneDistance + CATCH.droneDistancePerHeight * h;
    const e = CATCH.droneElevation * DEG;
    out.set(c.x + Math.sin(angle) * d * Math.cos(e), aimY + d * Math.sin(e), c.z + Math.cos(angle) * d * Math.cos(e));
    return angle;
  };

  /** Chase view blending into the drone view on the approach near the tower; sets `yaw`. */
  const placeCamera = (dt: number): void => {
    const p = booster.object.position;
    const h = Math.max(0, p.y + geo.pinHeight - geo.catchY);
    const chasePitch = chaseView(chase);
    const near = smoothstep((2 * CATCH.droneRadius - Math.hypot(p.x, p.z)) / CATCH.droneRadius);
    const w = near * smoothstep((CATCH.approachHeight - h) / (CATCH.approachHeight * 0.4));
    if (w > 0) swing += dt;
    const droneYaw = droneView(drone, h);
    camera.position.lerpVectors(chase, drone, w);
    yaw = droneYaw * w;
    camEuler.set(-(chasePitch + (CATCH.droneElevation * DEG - chasePitch) * w), yaw, 0);
    camera.quaternion.setFromEuler(camEuler);
  };

  const stage: Stage = {
    scored: true,
    start() {
      run++;
      elapsed = 0;
      sim = createCatchSim(geo, Math.random);
      ending = undefined;
      endResult = undefined;
      endIn = undefined;
      result = undefined;
      effects.clear();
      world.resetToPad();
      ship.object.visible = false;
      scene.add(target.group);
      swing = 0;
      pose();
      placeCamera(0);
      hud.clear();
      void voice.say('catch_intro');
      void voice.queue('catch_steer');
    },
    update(dt) {
      elapsed += dt;
      const s = sim.state;
      if (!ending) {
        const i = input.state;
        for (const e of sim.step(dt, { ...i, ...screenStick(i.stickX, i.stickY, yaw) })) handle(e);
      }
      if (!ending) {
        pose();
        hud.setThrottle(input.state.throttle);
        hud.setFuel(s.fuel);
        hud.setSpeedLight(s.light);
      } else if (ending.kind === 'caught') {
        ending.t += dt;
        const k = smoothstep(ending.t / CATCH.closeSeconds);
        tower.setChopsticks(k);
        booster.object.position.lerpVectors(ending.startPos, caughtAt, k);
        booster.object.quaternion.slerpQuaternions(ending.startQ, tiltQ.identity(), k);
      }
      target.group.visible = ending?.kind !== 'caught';
      if (!ending || ending.kind === 'caught') placeCamera(dt);
      target.update(elapsed, camera.position.distanceTo(tower.catchPoint), inCatchBox(geo, s.x, s.z));
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
