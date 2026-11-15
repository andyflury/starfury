import { BoxGeometry, Color, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { DEPLOY } from '../tuning.ts';
import type { Stage, StageFactory, StageResult } from '../types.ts';
import { createDeploy, type DeployEvent, type DeployState, goodCount, screenTiltOf, stepDeploy, tiltOf, windowShare } from './deploySim.ts';

const RAD = Math.PI / 180;
/** Window lamps: count, size along the hull, gap between them, the first lamp's distance below the slot, and their place around the hull from the slot towards the ship's local +X, degrees. */
const LAMPS = 10;
const LAMP_SIZE = 1.6;
const LAMP_GAP = 0.6;
const LAMP_START = 2.2;
const LAMP_ANGLE = 55;
/** Lamp colours from plenty of time left to little, and the share left below which the last lamp blinks. */
const LAMP_GREEN = new Color(0x34e07a);
const LAMP_YELLOW = new Color(0xffd23a);
const LAMP_RED = new Color(0xff3b30);
const LAMP_BLINK = 0.2;
/** Positions of a slab's lights along its outer long edge, as shares of its half width. */
const SLAB_LIGHTS = [-0.9, -0.2, 0.9];

const Y = new Vector3(0, 1, 0);
/** The slot's direction in world space while the ship is steady. */
const SLOT_OUT = new Vector3(1, 0, 0);

/** A satellite: aboard, sliding out of the slot with the ship, or free in space. */
interface Satellite {
  readonly object: Group;
  fate: 'aboard' | 'good' | 'bad';
  /** Seconds since release, and since it cleared the hull. */
  t: number;
  freeT: number;
  /** Whether it has cleared the hull and moves in world space. */
  free: boolean;
  /** World direction it drifts in once free, and its attitude when it cleared the hull. */
  readonly dir: Vector3;
  readonly freeAttitude: Quaternion;
  /** A bad one's tumble axis. */
  readonly spin: Vector3;
}

/** Starlink deploy: the ship in orbit releases five satellites through its payload slot while the player keeps it steady. */
export const createDeployStage: StageFactory = (app) => {
  const { world, effects, hud, input, voice, sfx, camera, scene } = app;
  const { ship } = world;
  const exit = ship.payloadExit;

  /** The slot's outward direction across the hull, in the ship's local space. */
  const radial = exit.direction.clone().addScaledVector(Y, -exit.direction.dot(Y)).normalize();
  /** Steady attitude: nose up, the slot facing `SLOT_OUT`. */
  const steady = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(SLOT_OUT, Y, new Vector3().crossVectors(SLOT_OUT, Y)).multiply(new Matrix4().makeBasis(radial, Y, new Vector3().crossVectors(radial, Y)).transpose()),
  );

  /** The slab: as wide as the slot and as thick as a share of its height, less the margins; flat across the slot. */
  const width = exit.width - 2 * DEPLOY.slotMargin;
  const thickness = exit.height * DEPLOY.slabThickness;
  const depth = DEPLOY.slabDepth;
  /** The slab's attitude in the ship's local space: long edge across the slot, thin along the ship's axis, deep along the exit. */
  const slabLocal = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(Y, exit.direction).normalize(), Y, exit.direction));
  /** Distance along the exit from `exit.position` of an aboard slab's centre, its outer edge just inside the hull. */
  const restOffset = -depth / 2 - 0.05;
  /** Distance along the exit from `exit.position` at which a sliding slab's inner edge has cleared the hull. */
  const clearOffset = depth / 2 + DEPLOY.clearance;

  const slabMaterial = new MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.45 });
  const lightMaterial = new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 3 });
  const slabGeo = new BoxGeometry(width, thickness, depth);
  const lightGeo = new BoxGeometry(0.22, 0.12, 0.22);

  /** A satellite aboard: a dark slab with small lights along its outer edge. */
  const makeSatellite = (): Satellite => {
    const object = new Group();
    object.add(new Mesh(slabGeo, slabMaterial));
    for (const f of SLAB_LIGHTS) {
      const light = new Mesh(lightGeo, lightMaterial);
      light.position.set((f * width) / 2, thickness / 2 + 0.03, depth / 2 - 0.2);
      object.add(light);
    }
    return { object, fate: 'aboard', t: 0, freeT: 0, free: false, dir: new Vector3(), freeAttitude: new Quaternion(), spin: new Vector3() };
  };

  const lampMaterials = Array.from({ length: LAMPS }, () => new MeshStandardMaterial({ color: 0x111111, emissive: LAMP_GREEN.clone(), emissiveIntensity: 2 }));
  /** The window lamps: a column on the hull below the slot, on the ship. */
  const lamps = new Group();
  {
    const out = radial.clone().applyAxisAngle(Y, LAMP_ANGLE * RAD);
    const geo = new BoxGeometry(LAMP_SIZE * 0.8, LAMP_SIZE, 0.25);
    lampMaterials.forEach((m, i) => {
      const lamp = new Mesh(geo, m);
      lamp.position.copy(out).multiplyScalar(ship.radius + 0.1);
      lamp.position.y = exit.position.y - LAMP_START - i * (LAMP_SIZE + LAMP_GAP);
      lamp.lookAt(lamp.position.clone().add(out));
      lamps.add(lamp);
    });
  }

  let sim: DeployState = createDeploy(Math.random);
  let sats: Satellite[] = [];
  const group = new Group();
  let ending: { left: number; result: StageResult } | undefined;
  let result: StageResult | undefined;
  /** Seconds since the stage started, and since its ending began. */
  let clock = 0;
  let endClock = 0;

  /** The camera's swing about +Y around its aim, radians. */
  const swingOf = (t: number): number => DEPLOY.cameraSwing * RAD * Math.sin((2 * Math.PI * t) / DEPLOY.cameraSwingSeconds);
  const side = new Vector3().crossVectors(Y, SLOT_OUT);
  const aim = new Vector3();
  const offset = new Vector3();
  /** The resting camera's axes, which the simulation's axes follow. */
  const restRight = new Vector3();
  const restForward = new Vector3();
  const restUp = new Vector3();
  const camRight = new Vector3();

  /** Places the camera at swing `swing` above the ship and to the side of the slot, looking down on it with the slabs leaving sideways. */
  const placeCamera = (swing: number): void => {
    aim.copy(Y).multiplyScalar(exit.position.y - ship.height / 2 + DEPLOY.cameraAimUp).addScaledVector(SLOT_OUT, DEPLOY.cameraAimOut);
    const az = DEPLOY.cameraSide * RAD + swing;
    const el = DEPLOY.cameraElevation * RAD;
    offset
      .copy(SLOT_OUT)
      .multiplyScalar(Math.cos(az))
      .addScaledVector(side, Math.sin(az))
      .multiplyScalar(Math.cos(el))
      .addScaledVector(Y, Math.sin(el))
      .multiplyScalar(DEPLOY.cameraDistance);
    camera.position.copy(aim).add(offset);
    camera.up.copy(Y);
    camera.lookAt(aim);
  };
  /** The camera's swing measured in the simulation's axes, radians. */
  const yawOf = (): number => {
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    return Math.atan2(camRight.dot(restForward), camRight.dot(restRight));
  };

  const error = new Quaternion();
  const axis = new Vector3();
  const tmp = new Vector3();
  /** Turns the ship from steady by the simulation's error, drawn `leanScale` times larger, about its centre at the origin. */
  const placeShip = (s: DeployState): void => {
    const t = tiltOf(s);
    if (t > 0) {
      axis.crossVectors(restUp, restRight).multiplyScalar(s.x).addScaledVector(tmp.crossVectors(restUp, restForward), s.y).normalize();
      error.setFromAxisAngle(axis, t * DEPLOY.leanScale * RAD);
    } else error.identity();
    ship.object.quaternion.copy(error).multiply(steady);
    ship.object.position.copy(Y).multiplyScalar(-ship.height / 2).applyQuaternion(ship.object.quaternion);
    ship.object.updateMatrixWorld();
  };

  /** Puts a satellite into the slot, `along` metres out along the exit from `exit.position`, in the ship's local space. */
  const inSlot = (sat: Satellite, along: number): void => {
    sat.object.position.copy(exit.position).addScaledVector(exit.direction, along);
    sat.object.quaternion.copy(slabLocal);
  };
  /** Shows the next satellite aboard resting in the slot once the slot is empty. */
  const loadNext = (): void => {
    if (sats.some((s) => s.fate !== 'aboard' && !s.free)) return;
    const next = sats.find((s) => s.fate === 'aboard');
    if (!next || next.object.visible || sim.phase === 'finish' || sim.phase === 'done') return;
    inSlot(next, restOffset);
    next.object.visible = true;
  };

  const release = (index: number, good: boolean): void => {
    const sat = sats[index];
    if (!sat) return;
    sat.fate = good ? 'good' : 'bad';
    sat.t = 0;
    inSlot(sat, restOffset);
    sat.object.visible = true;
    if (good) {
      sfx.star();
      if (!voice.speaking) void voice.say('deploy_good');
    } else {
      sat.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      sfx.fail();
      if (!voice.speaking) void voice.say('deploy_bad');
    }
  };

  /** Hands a satellite that has cleared the hull from the ship to space, drifting level along the slot's direction, a bad one also swerving sideways. */
  const setFree = (sat: Satellite): void => {
    group.attach(sat.object);
    sat.free = true;
    sat.freeT = 0;
    sat.freeAttitude.copy(sat.object.quaternion);
    sat.dir.copy(exit.direction).transformDirection(ship.object.matrixWorld).setY(0).normalize();
    if (sat.fate === 'bad') sat.dir.addScaledVector(tmp.crossVectors(Y, sat.dir), Math.tan(DEPLOY.lostSwerve * RAD) * (Math.random() < 0.5 ? -1 : 1)).normalize();
  };

  const spinQ = new Quaternion();
  /** Slides released satellites out of the slot with the ship, then drifts them away: a good one level, a bad one tumbling. */
  const moveSatellites = (dt: number): void => {
    for (const sat of sats) {
      if (sat.fate === 'aboard') continue;
      sat.t += dt;
      if (!sat.free) {
        const along = restOffset + DEPLOY.exitSpeed * sat.t;
        inSlot(sat, Math.min(along, clearOffset));
        if (along >= clearOffset) setFree(sat);
        continue;
      }
      sat.freeT += dt;
      const speed = sat.fate === 'good' ? DEPLOY.exitSpeed : DEPLOY.exitSpeed + (DEPLOY.lostSpeed - DEPLOY.exitSpeed) * Math.min(1, sat.freeT);
      sat.object.position.addScaledVector(sat.dir, speed * dt);
      if (sat.fate === 'bad') {
        const t = Math.max(0, sat.freeT - DEPLOY.lostSpinDelay);
        sat.object.quaternion.copy(spinQ.setFromAxisAngle(sat.spin, (DEPLOY.lostSpin * RAD * t * t) / (t + 1))).multiply(sat.freeAttitude);
      }
    }
    loadNext();
  };

  /** Lights the lamps for the share of the window left, green to yellow to red, the last one blinking. */
  const showWindow = (share: number): void => {
    const lit = Math.ceil(share * LAMPS - 1e-9);
    const colour = share > 0.5 ? LAMP_GREEN : share > 0.25 ? LAMP_YELLOW : LAMP_RED;
    const blinkOn = share > LAMP_BLINK || Math.sin(clock * 2 * Math.PI * 2) > 0;
    lampMaterials.forEach((m, i) => {
      m.emissive.copy(colour);
      m.emissiveIntensity = i < lit && (blinkOn || i < lit - 1) ? 2.2 : 0;
    });
  };

  const end = (r: StageResult): void => {
    hud.clear();
    ending = { left: DEPLOY.endPause, result: r };
    endClock = 0;
  };

  const handle = (e: DeployEvent): void => {
    switch (e.kind) {
      case 'open':
        hud.setPips(0, DEPLOY.satellites);
        break;
      case 'release':
        release(e.index, e.good);
        hud.setPips(goodCount(sim), DEPLOY.satellites);
        break;
      case 'closed':
        for (const sat of sats) if (sat.fate === 'aboard') sat.object.visible = false;
        break;
      case 'complete':
        if (e.stars > 0) {
          void voice.say('deploy_done');
          end({ outcome: 'success', stars: e.stars });
        } else {
          sfx.fail();
          void voice.say('deploy_none');
          end({ outcome: 'fail', stars: 0 });
        }
        break;
    }
  };

  /** The door: opening during the intro, closing from `doorDelay` into the finish. */
  const doorOf = (s: DeployState): number => {
    if (s.phase === 'intro' || s.phase === 'window') return Math.min(1, s.t / DEPLOY.doorSeconds);
    const closing = s.phase === 'finish' ? DEPLOY.finishSeconds - s.finishLeft : DEPLOY.finishSeconds + endClock;
    return Math.max(0, Math.min(1, 1 - (closing - DEPLOY.doorDelay) / DEPLOY.doorSeconds));
  };

  const frame = (dt: number): void => {
    clock += dt;
    placeCamera(swingOf(clock));
    placeShip(sim);
    moveSatellites(dt);
    ship.setPayloadDoor(doorOf(sim));
    showWindow(sim.phase === 'intro' ? 1 : windowShare(sim));
  };

  /** Removes every satellite from the ship and from space. */
  const clearSatellites = (): void => {
    for (const sat of sats) sat.object.removeFromParent();
    sats = [];
  };

  return {
    scored: true,
    start() {
      clearSatellites();
      sim = createDeploy(Math.random);
      sats = Array.from({ length: DEPLOY.satellites }, makeSatellite);
      for (const sat of sats) {
        sat.object.visible = false;
        ship.object.add(sat.object);
      }
      if (!group.parent) scene.add(group);
      ship.object.add(lamps);
      ending = undefined;
      result = undefined;
      clock = 0;
      endClock = 0;
      voice.stop();
      world.resetToPad();
      world.setEnvironment('orbit');
      world.booster.object.visible = false;
      effects.clear();
      hud.clear();
      sfx.setEngine(0);
      ship.setEnginesLit(0);
      ship.setFlaps(0, 0);
      ship.setPayloadDoor(0);
      placeCamera(0);
      camera.updateMatrixWorld();
      restRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      restUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      restForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      placeShip(sim);
      loadNext();
      void voice.say('deploy_intro');
      void voice.queue('deploy_how');
    },
    update(dt) {
      if (ending) {
        endClock += dt;
        frame(dt);
        if (!voice.speaking) ending.left -= dt;
        if (ending.left <= 0) result = ending.result;
        return;
      }
      const yaw = yawOf();
      for (const e of stepDeploy(sim, dt, input.state, input.confirm, yaw, Math.random)) handle(e);
      frame(dt);
      if (ending) return;
      const level = screenTiltOf(sim, yaw);
      if (sim.phase === 'window') hud.setTilt(level.right, level.away, DEPLOY.releaseLimit, DEPLOY.maxTilt);
      else hud.setTilt(undefined);
    },
    result: () => result,
    stop() {
      clearSatellites();
      scene.remove(group);
      ship.object.remove(lamps);
      ship.setPayloadDoor(0);
      world.booster.object.visible = true;
      hud.clear();
      effects.clear();
    },
  } satisfies Stage;
};
