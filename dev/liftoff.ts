import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createAudio } from '../src/audio/index.ts';
import { createLiftoffStage } from '../src/stages/liftoff.ts';
import { createBoostback } from '../src/stages/boostback.ts';
import type { App, Input, InputState, Stage } from '../src/types.ts';
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
const state: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: false };
const input: Input = { poll() {}, state, confirm: false, flush() {}, source: 'keyboard', mapped: false };
const app: App = { scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay };

const factories = { liftoff: createLiftoffStage, boostback: createBoostback };
let stage: Stage | undefined;
let time = 0;

/** Scripting hooks for headless screenshots: start a stage, set the input, step the stage in 1/30 s frames, render. */
const harness = {
  input: state,
  footprint: world.tower.footprint,
  /** The booster's lean: degrees from upright, and degrees of it along -X, towards the tower. */
  lean() {
    const axis = new Vector3(0, 1, 0).applyQuaternion(world.booster.object.quaternion);
    const deg = (Math.acos(Math.min(1, axis.y)) * 180) / Math.PI;
    return { deg, towardTower: (Math.asin(Math.max(-1, Math.min(1, -axis.x))) * 180) / Math.PI, baseX: world.booster.object.position.x };
  },
  start(name: keyof typeof factories) {
    stage?.stop();
    stage = factories[name](app);
    time = 0;
    stage.start();
    renderer.render(scene, camera);
  },
  /** Steps `seconds`, calling `script(t)` before each frame with the stage time. */
  step(seconds: number, script?: (t: number, s: InputState) => void) {
    const dt = 1 / 30;
    let lowest = Infinity;
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      script?.(time, state);
      time += dt;
      stage?.update(dt);
      world.update(dt);
      effects.update(dt, camera);
      lowest = Math.min(lowest, camera.position.y);
    }
    renderer.render(scene, camera);
    return { time, result: stage?.result(), lowestCameraY: Math.round(lowest * 10) / 10 };
  },
  rampThrottle: (rate = 0.7) => (_t: number, s: InputState) => {
    s.throttle = Math.min(1, s.throttle + rate / 30);
  },
};
Object.assign(window, { h: harness });
