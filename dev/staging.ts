// Steps the hot-staging stage or the boostback cutscene under a scripted pilot, then renders that moment.
//   h.start('staging' | 'boostback'), then h.run({ until, flip, up, rate, hold }) from the console or shot.mjs `eval:`.
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createAudio } from '../src/audio/index.ts';
import { createBoostback } from '../src/stages/boostback.ts';
import { createStagingStage } from '../src/stages/staging.ts';
import { STAGING } from '../src/tuning.ts';
import type { App, InputState, Stage } from '../src/types.ts';
import { createHud } from '../src/ui/hud.ts';
import '../src/ui/styles.css';
import { configureRenderer, createEffects, createWorld } from '../src/world/index.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (!canvas || !overlay) throw new Error('missing #scene or #overlay');

const renderer = new WebGLRenderer({ canvas, antialias: true });
configureRenderer(renderer);
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new Scene();
const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 30_000);
const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud(overlay);
const state: InputState = { throttle: 1, stickX: 0, stickY: 0, armed: false };
const input = { poll() {}, state, confirm: false, flush() {}, source: 'keyboard' as const, mapped: false };
const app: App = { scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay };

/** Stage time the count showed 3, undefined before. */
let three: number | undefined;
const setCountdown = hud.setCountdown.bind(hud);
hud.setCountdown = (n) => {
  if (n === STAGING.countFrom && three === undefined) three = time;
  setCountdown(n);
};

const factories = { staging: createStagingStage, boostback: createBoostback };
let stage: Stage | undefined;
let time = 0;
let flipped: number | undefined;

/** The scripted pilot of `run`. */
interface Pilot {
  /** Stage time to step to. */
  until: number;
  /** Flip this many seconds from zero; never when absent. */
  flip?: number;
  /** Seconds after the flip before the throttle starts rising, at `rate` per second. */
  up?: number;
  rate?: number;
  /** Stage time from which the throttle is pulled down, at 2 per second; it stays up when absent. */
  down?: number;
  /** Throttle level held after the flip instead of rising, when given. */
  hold?: number;
}

/** Scripting hooks for headless screenshots: start a stage, step it in 1/30 s frames under a pilot, render. */
const harness = {
  input: state,
  world,
  camera,
  start(name: keyof typeof factories) {
    stage?.stop();
    stage = factories[name](app);
    time = 0;
    three = undefined;
    flipped = undefined;
    state.throttle = 1;
    stage.start();
    renderer.render(scene, camera);
  },
  run(p: Pilot) {
    const dt = 1 / 30;
    while (time < p.until - 1e-6 && !stage?.result()) {
      input.confirm = false;
      if (p.down !== undefined && time >= p.down && flipped === undefined) state.throttle = Math.max(0, state.throttle - 2 * dt);
      if (p.flip !== undefined && flipped === undefined && three !== undefined && time >= three + STAGING.countFrom + p.flip) {
        flipped = time;
        input.confirm = true;
      }
      if (flipped !== undefined) {
        if (p.hold !== undefined) state.throttle = p.hold;
        else if (time >= flipped + (p.up ?? 0.3)) state.throttle = Math.min(1, state.throttle + (p.rate ?? 3) * dt);
      }
      time += dt;
      stage?.update(dt);
      world.update(dt);
      effects.update(dt, camera);
    }
    renderer.render(scene, camera);
    return { time: Math.round(time * 100) / 100, result: stage?.result(), throttle: state.throttle, flipped, three };
  },
};
Object.assign(window, { h: harness });
