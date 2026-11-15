import { AdditiveBlending, CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three';
import { STAGING } from '../tuning.ts';
import type { LineId, Stage, StageFactory, StageResult } from '../types.ts';
import { createStaging, type StagingEvent, type StagingState, stepStaging } from './stagingSim.ts';

/** Number of fire tongues venting from the ring between the stages. */
const VENTS = 10;

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

/** An additive glow sprite; `depthTest` false draws it over the hulls. */
const glow = (map: CanvasTexture, depthTest: boolean): Sprite =>
  new Sprite(new SpriteMaterial({ map, blending: AdditiveBlending, depthWrite: false, depthTest, transparent: true, fog: false }));

/** Hot staging: throttle down, flip the Arm switch at zero of the count, then full throttle to pull the ship away. */
export const createStagingStage: StageFactory = (app) => {
  const { world, effects, hud, input, voice, sfx, camera, scene } = app;
  const { booster, ship } = world;
  const map = flashTexture();
  const flash = glow(map, false);
  const vents = Array.from({ length: VENTS }, () => glow(map, true));
  /** Towards the camera and right on screen, on the ground. */
  const back = new Vector3(Math.sin(STAGING.cameraYaw), 0, Math.cos(STAGING.cameraYaw));
  const right = new Vector3(Math.cos(STAGING.cameraYaw), 0, -Math.sin(STAGING.cameraYaw));
  /** The ship's base, where the stages join; the camera follows it. */
  const join = new Vector3();
  const look = new Vector3();

  let sim: StagingState = createStaging();
  let ending: { left: number; result: StageResult } | undefined;
  let result: StageResult | undefined;
  /** Seconds the stack has climbed; stops at an explosion or engine loss. */
  let climbT = 0;
  /** Seconds since the flip, undefined before it. */
  let flipT: number | undefined;
  /** Seconds since the ship pulled away, undefined before it. */
  let pullT: number | undefined;
  /** 0 frames the booster's engines, 1 the join. */
  let focus = 0;

  const placeVehicles = (): void => {
    join.set(world.padPoint.x, STAGING.startHeight + booster.height + STAGING.climbSpeed * climbT, world.padPoint.z);
    ship.object.position.copy(join);
    booster.object.position.copy(join).setY(join.y - booster.height - sim.gap);
  };

  /** Looks at the booster's engines while the throttle comes down, then at the join, then up the ship after success. */
  const placeCamera = (dt: number): void => {
    focus = Math.min(1, Math.max(0, focus + (sim.phase === 'throttleDown' ? -dt : dt) * STAGING.focusRate));
    const f = focus * focus * (3 - 2 * focus);
    const p = pullT === undefined ? 0 : Math.min(1, pullT / 2);
    const e = p * p * (3 - 2 * p);
    const engines = join.y - booster.height + STAGING.engineViewLook;
    const dist = STAGING.engineViewDistance + (STAGING.cameraDistance - STAGING.engineViewDistance) * f + STAGING.successPullBack * e;
    look.copy(join).setY(engines + (join.y - engines) * f + STAGING.successLook * e);
    camera.position.copy(look).addScaledVector(back, dist);
    camera.position.y -= STAGING.cameraBelow * f;
    camera.lookAt(look.addScaledVector(right, -dist * STAGING.cameraShift));
  };

  /** Fades the flash and animates the fire venting outward from the ring. */
  const placeGlow = (): void => {
    const age = flipT ?? Infinity;
    const m = flash.material;
    m.opacity = Math.max(0, 1 - age / STAGING.flashFade);
    flash.visible = m.opacity > 0;
    flash.position.copy(join);
    flash.scale.setScalar(STAGING.flashSize * (1 + age * 1.5));
    const fade = Math.max(0, 1 - age / STAGING.ventSeconds);
    vents.forEach((v, i) => {
      const phase = (age * 2.2 + i * 0.37) % 1;
      const a = (i / VENTS) * Math.PI * 2;
      const r = booster.radius + phase * 14;
      v.visible = fade > 0;
      v.material.opacity = fade * (1 - phase);
      v.position.set(join.x + Math.cos(a) * r, join.y - sim.gap * 0.5 + phase * 2, join.z + Math.sin(a) * r);
      v.scale.setScalar(5 + phase * 12);
    });
  };

  const enginesOff = (): void => {
    booster.setEnginesLit(0);
    ship.setEnginesLit(0);
    effects.setExhaust(booster, 0);
    effects.setExhaust(ship, 0);
    sfx.setEngine(0);
  };

  const end = (r: StageResult): void => {
    hud.clear();
    ending = { left: STAGING.endPause, result: r };
  };

  const explode = (line: LineId): void => {
    effects.explode(join);
    booster.object.visible = false;
    ship.object.visible = false;
    enginesOff();
    effects.shake(1);
    sfx.explosion();
    void voice.say(line);
    end({ outcome: 'fail', stars: 0 });
  };

  const handle = (e: StagingEvent): void => {
    switch (e.kind) {
      case 'prompt':
        void voice.say('staging_intro');
        break;
      case 'countPrompt':
        void voice.say('staging_count');
        break;
      case 'count':
        void voice.say(`count_${e.n}` as LineId);
        sfx.tick();
        break;
      case 'countStopped':
        break;
      case 'separate':
        flipT = 0;
        ship.setEnginesLit(ship.engineCount);
        booster.setEnginesLit(3);
        effects.setExhaust(booster, 0.25);
        effects.shake(STAGING.flipShake);
        void voice.say('staging_fire');
        break;
      case 'early':
        explode('staging_early');
        break;
      case 'late':
        enginesOff();
        sfx.fail();
        void voice.say('staging_late');
        end({ outcome: 'fail', stars: 0 });
        break;
      case 'pullAway':
        pullT = 0;
        break;
      case 'weak':
        explode('staging_weak');
        break;
      case 'complete':
        void voice.queue('staging_done');
        end({ outcome: 'success', stars: e.stars });
        break;
    }
  };

  /** Sets the HUD, engines, plumes and sound from the phase and the throttle. */
  const present = (): void => {
    const throttle = input.state.throttle;
    hud.setCountdown(sim.digit);
    if (sim.phase === 'throttleDown') hud.setThrottle(throttle, 0, STAGING.throttleLow);
    else if (sim.phase === 'count') hud.setThrottle(throttle, 0, STAGING.countThrottle);
    else if (sim.phase === 'fire') hud.setThrottle(throttle, STAGING.fullThrottle);
    else hud.setThrottle(undefined);
    if (flipT === undefined) {
      const f = Math.max(0, (throttle - STAGING.throttleLow) / (1 - STAGING.throttleLow));
      booster.setEnginesLit(3 + Math.round(f * (booster.engineCount - 3)));
      effects.setExhaust(booster, Math.max(0.2, throttle));
      sfx.setEngine(Math.max(0.2, throttle));
      return;
    }
    if (flipT >= STAGING.boosterCutoff) {
      booster.setEnginesLit(0);
      effects.setExhaust(booster, 0);
    }
    const level = sim.phase === 'fire' ? 0.35 + 0.65 * throttle : 1;
    effects.setExhaust(ship, level);
    sfx.setEngine(level);
  };

  const advance = (dt: number): void => {
    if (sim.phase !== 'exploded' && sim.phase !== 'failed') climbT += dt;
    if (flipT !== undefined) flipT += dt;
    if (pullT !== undefined) pullT += dt;
    placeVehicles();
    placeCamera(dt);
    placeGlow();
  };

  return {
    scored: true,
    start() {
      sim = createStaging();
      ending = undefined;
      result = undefined;
      climbT = 0;
      flipT = undefined;
      pullT = undefined;
      focus = 0;
      voice.stop();
      world.resetToPad();
      world.setSkyAltitude(STAGING.skyAltitude);
      effects.clear();
      hud.clear();
      ship.setEnginesLit(0);
      booster.setEnginesLit(booster.engineCount);
      effects.setExhaust(booster, 1);
      sfx.setEngine(1);
      scene.add(flash, ...vents);
      advance(0);
    },
    update(dt) {
      if (ending) {
        if (sim.phase === 'complete') stepStaging(sim, dt, input.state, false);
        advance(dt);
        if (!voice.speaking) ending.left -= dt;
        if (ending.left <= 0) result = ending.result;
        return;
      }
      for (const e of stepStaging(sim, dt, input.state, input.confirm)) handle(e);
      advance(dt);
      if (!ending) present();
    },
    result: () => result,
    stop() {
      flash.removeFromParent();
      for (const v of vents) v.removeFromParent();
      hud.clear();
      effects.clear();
      sfx.setEngine(0);
      world.resetToPad();
    },
  } satisfies Stage;
};
