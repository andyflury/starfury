import { Color, Group, Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3 } from 'three';
import { MAXQ } from '../tuning.ts';
import type { Stage, StageFactory, StageResult } from '../types.ts';
import { createMaxq, type MaxqEvent, type MaxqState, pathFrame, progressOf, stepMaxq } from './maxqSim.ts';

/** Ring colours: the next to fly through, the ones after it, flown through, and missed. */
const NEXT = new Color(1, 0.78, 0.15);
const LATER = new Color(1, 0.88, 0.5);
const HIT = new Color(0.25, 1, 0.45);
const MISSED = new Color(0.55, 0.55, 0.6);
/** Seconds a passed ring takes to fade out, and how much it grows meanwhile. */
const FADE = 1.2;
const GROW = 0.35;
/** Opacity of the rings after the next one. */
const LATER_OPACITY = 0.85;

const UP = new Vector3(0, 1, 0);
const FACING = new Vector3(0, 0, 1);
const RIGHT = new Vector3(1, 0, 0);

/** A ring of light: a dark rim under a bright core, so it reads against bright and dark sky. */
interface RingView {
  readonly group: Group;
  readonly core: MeshBasicMaterial;
  readonly rim: MeshBasicMaterial;
  /** Seconds since it was passed, undefined before. */
  passed: number | undefined;
}

/** The Max-Q ascent: rings to fly through and the throttle eased through the densest air, run by `maxqSim`. */
export const createMaxqStage: StageFactory = (app) => {
  const { world, effects, hud, input, voice, sfx, camera, scene } = app;
  const { booster, ship } = world;
  const height = booster.height + ship.height;
  const origin = new Vector3();
  const tangent = new Vector3();
  const across = new Vector3();
  const mid = new Vector3();
  const axis = new Vector3();
  const look = new Vector3();
  const tilt = new Quaternion();

  const rings = new Group();
  const coreGeometry = new TorusGeometry(MAXQ.ringRadius, 1.6, 10, 72);
  const rimGeometry = new TorusGeometry(MAXQ.ringRadius, 2.8, 10, 72);
  const views: RingView[] = [];

  let sim: MaxqState = createMaxq(Math.random);
  let ending: { left: number; result: StageResult } | undefined;
  let result: StageResult | undefined;
  /** The camera's smoothed across-path offset. */
  let camX = 0;
  let camY = 0;
  let clock = 0;

  /** Sets `out` to the world point at path distance `s`, `x` right and `y` up across the path; sets `tangent` and `across` there. */
  const pathPoint = (s: number, x: number, y: number, out: Vector3): Vector3 => {
    const f = pathFrame(s);
    tangent.fromArray(f.tangent);
    across.fromArray(f.up);
    return out.fromArray(f.position).add(origin).addScaledVector(RIGHT, x).addScaledVector(across, y);
  };

  const buildRings = (): void => {
    for (const v of views) {
      v.group.removeFromParent();
      v.core.dispose();
      v.rim.dispose();
    }
    views.length = 0;
    for (const ring of sim.rings) {
      const rim = new MeshBasicMaterial({ color: 0x140c28, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
      const core = new MeshBasicMaterial({ color: LATER, transparent: true, fog: false, toneMapped: false });
      const group = new Group();
      const rimMesh = new Mesh(rimGeometry, rim);
      const coreMesh = new Mesh(coreGeometry, core);
      rimMesh.renderOrder = 1;
      coreMesh.renderOrder = 2;
      group.add(rimMesh, coreMesh);
      pathPoint(ring.s, ring.x, ring.y, group.position);
      group.quaternion.setFromUnitVectors(FACING, tangent);
      rings.add(group);
      views.push({ group, core, rim, passed: undefined });
    }
  };

  /** Colours the next ring, dims the later ones and fades out the passed ones. */
  const updateRings = (dt: number): void => {
    const pulse = 0.85 + 0.15 * Math.sin(clock * 6);
    views.forEach((v, i) => {
      const ring = sim.rings[i];
      if (!ring) return;
      if (v.passed !== undefined) {
        v.passed += dt;
        const f = Math.min(1, v.passed / FADE);
        v.group.scale.setScalar(1 + (ring.hit ? GROW : 0) * f);
        v.core.opacity = 1 - f;
        v.rim.opacity = 0.55 * (1 - f);
        v.group.visible = f < 1;
        return;
      }
      const next = i === sim.next;
      v.core.color.copy(next ? NEXT : LATER).multiplyScalar(next ? pulse : 1);
      v.core.opacity = next ? 1 : LATER_OPACITY;
      v.rim.opacity = next ? 0.55 : 0.4;
    });
  };

  /** Copies the simulation's pose onto the stacked vehicles: middle on the path, axis along the flight direction. */
  const placeVehicles = (s: MaxqState): void => {
    pathPoint(s.s, s.x, s.y, mid);
    axis.copy(tangent).multiplyScalar(s.speed).addScaledVector(RIGHT, s.vx).addScaledVector(across, s.vy).normalize();
    tilt.setFromUnitVectors(UP, axis);
    booster.object.position.copy(mid).addScaledVector(axis, -height / 2);
    booster.object.quaternion.copy(tilt);
    ship.object.position.copy(booster.object.position).addScaledVector(axis, booster.height);
    ship.object.quaternion.copy(tilt);
  };

  /** Places the camera behind, left of and above the rocket, looking ahead along the path; it follows sideways with a lag. */
  const placeCamera = (s: MaxqState, dt: number): void => {
    const k = Math.min(1, dt / MAXQ.cameraLag);
    camX += (s.x - camX) * k;
    camY += (s.y - camY) * k;
    pathPoint(s.s, camX, camY, look);
    camera.position.copy(look).addScaledVector(tangent, -MAXQ.cameraBack).addScaledVector(RIGHT, -MAXQ.cameraSide).addScaledVector(across, MAXQ.cameraRise);
    camera.up.copy(UP);
    camera.lookAt(look.addScaledVector(tangent, MAXQ.cameraAhead));
  };

  const enginesOff = (): void => {
    booster.setEnginesLit(0);
    effects.setExhaust(booster, 0);
    effects.setVapor(booster, 0);
    sfx.setEngine(0);
  };

  const end = (r: StageResult): void => {
    hud.clear();
    ending = { left: MAXQ.endPause, result: r };
  };

  const handle = (e: MaxqEvent): void => {
    switch (e.kind) {
      case 'intro':
        void voice.say('maxq_intro');
        break;
      case 'ease':
        void voice.queue('maxq_ease');
        break;
      case 'full':
        void voice.queue('maxq_full');
        break;
      case 'overload':
        if (!voice.speaking) void voice.say('maxq_overload');
        break;
      case 'ring': {
        const v = views[e.index];
        if (v) {
          v.passed = 0;
          v.core.color.copy(e.hit ? HIT : MISSED);
          v.core.opacity = 1;
        }
        if (e.hit) sfx.star();
        break;
      }
      case 'breakup':
        effects.explode(mid.clone());
        booster.object.visible = false;
        ship.object.visible = false;
        enginesOff();
        effects.shake(1);
        sfx.explosion();
        void voice.say('crash_rocket');
        end({ outcome: 'fail', stars: 0 });
        break;
      case 'complete':
        void voice.queue('maxq_done');
        end({ outcome: 'success', stars: e.stars });
        break;
    }
  };

  /** Sets the HUD, engines, exhaust, vapour, sound, shake and sky from the state and the throttle. */
  const present = (s: MaxqState, dt: number): void => {
    const throttle = input.state.throttle;
    if (s.air === 'ease') hud.setThrottle(throttle, MAXQ.bandFrom, MAXQ.bandTo);
    else hud.setThrottle(throttle);
    hud.setPressure(Math.min(1, s.pressure), MAXQ.red);
    hud.setPips(s.hits, MAXQ.rings);
    booster.setEnginesLit(Math.max(3, Math.round(throttle * booster.engineCount)));
    effects.setExhaust(booster, 0.3 + 0.7 * throttle);
    sfx.setEngine(throttle);
    effects.setVapor(booster, Math.min(1, Math.max(0, (s.pressure - MAXQ.vaporFrom) / (MAXQ.red - MAXQ.vaporFrom))));
    effects.shake((MAXQ.shake * s.pressure + (s.pressure >= MAXQ.red ? MAXQ.redShake : 0)) * dt);
  };

  return {
    scored: true,
    start() {
      sim = createMaxq(Math.random);
      ending = undefined;
      result = undefined;
      clock = 0;
      voice.stop();
      world.resetToPad();
      world.setSkyAltitude(MAXQ.skyStart);
      effects.clear();
      hud.clear();
      origin.copy(world.padPoint).add(new Vector3(0, MAXQ.startHeight + height / 2, 0));
      buildRings();
      scene.add(rings);
      camX = 0;
      camY = 0;
      placeVehicles(sim);
      placeCamera(sim, 1);
      present(sim, 0);
    },
    update(dt) {
      clock += dt;
      if (!ending) for (const e of stepMaxq(sim, dt, input.state)) handle(e);
      else if (sim.phase === 'complete') stepMaxq(sim, dt, input.state);
      if (sim.phase !== 'broken') placeVehicles(sim);
      placeCamera(sim, dt);
      updateRings(dt);
      world.setSkyAltitude(MAXQ.skyStart + (MAXQ.skyEnd - MAXQ.skyStart) * progressOf(sim));
      if (ending) {
        if (!voice.speaking) ending.left -= dt;
        if (ending.left <= 0) result = ending.result;
        return;
      }
      present(sim, dt);
    },
    result: () => result,
    stop() {
      rings.removeFromParent();
      hud.clear();
      effects.clear();
      sfx.setEngine(0);
      booster.setEnginesLit(0);
      ship.setEnginesLit(0);
      world.setSkyAltitude(0);
    },
  } satisfies Stage;
};
