import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createShell } from './app.ts';
import { createAudio } from './audio/index.ts';
import { createInput } from './input/index.ts';
import { createHud } from './ui/hud.ts';
import './ui/styles.css';
import { configureRenderer, createEffects, createWorld } from './world/index.ts';

const MAX_DT = 1 / 20;
/** Lowest the camera may sit above the ground, whatever a stage or a shake asks for. */
const MIN_CAMERA_HEIGHT = 2;

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const overlay = document.querySelector<HTMLElement>('#overlay');
if (!canvas || !overlay) throw new Error('index.html lacks #scene or #overlay');

const renderer = new WebGLRenderer({ canvas, antialias: true });
configureRenderer(renderer);
const scene = new Scene();
const camera = new PerspectiveCamera(55, 1, 1, 30_000);
const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const input = createInput();
const hud = createHud(overlay);

const resize = (): void => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

const shell = createShell({ scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay, audio });

let frameId = 0;
let last = 0;
const loop = (now: number): void => {
  const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
  last = now;
  shell.frame(dt);
  camera.position.y = Math.max(camera.position.y, MIN_CAMERA_HEIGHT);
  renderer.render(scene, camera);
  frameId = requestAnimationFrame(loop);
};
const resume = (): void => {
  last = performance.now();
  frameId = requestAnimationFrame(loop);
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(frameId);
  else resume();
});
resume();
