// Steps the deploy stage under a scripted pilot to stage time `t`, then renders that moment.
//   /dev/deploy.html?pilot=careful&t=20[&flips=4&seed=1&close=1]
// `close` moves the camera next to the slot after stepping.
// Pilots: careful (steers to steady, flips once steady for a second, at most `flips` times), hasty (never steers, flips
// as fast as allowed), steer (steers to steady, never flips), hold (holds the error at `right` and `away` degrees),
// nothing (no input).
import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import { createAudio } from '../src/audio/index.ts';
import { createDeployStage } from '../src/stages/deploy.ts';
import { DEPLOY } from '../src/tuning.ts';
import type { Input, InputState } from '../src/types.ts';
import { createHud } from '../src/ui/hud.ts';
import '../src/ui/styles.css';
import { configureRenderer, createEffects, createWorld } from '../src/world/index.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);

let seed = num('seed', 1) >>> 0;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

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
let flip = false;
const input: Input = {
  state,
  poll() {},
  get confirm() {
    return flip;
  },
  flush() {},
  source: 'keyboard',
  mapped: false,
};
const stage = createDeployStage({ scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay });

const DT = 1 / 60;
const ship = world.ship.object;
const steady = new Quaternion();
const err = new Quaternion();
const rest = { up: new Vector3(), right: new Vector3(), forward: new Vector3() };

/** The attitude error behind the ship's drawn turn from steady, degrees towards the screen's right and away from the camera. */
function lean(): { right: number; away: number } {
  err.copy(ship.quaternion).multiply(steady.clone().invert());
  const angle = 2 * Math.acos(Math.min(1, Math.abs(err.w)));
  const axis = new Vector3(err.x, err.y, err.z).normalize().multiplyScalar(((angle * 180) / Math.PI / DEPLOY.leanScale) * Math.sign(err.w || 1));
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const away = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return { right: axis.dot(new Vector3().crossVectors(rest.up, right)), away: axis.dot(new Vector3().crossVectors(rest.up, away)) };
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
let steadyT = 0;
let reload = 0;
let flips = 0;
function steer(): number {
  const l = lean();
  const size = Math.hypot(l.right, l.away);
  state.stickX = size > 1.5 ? clamp(-l.right / 3) : 0;
  state.stickY = size > 1.5 ? clamp(-l.away / 3) : 0;
  return size;
}
const pilots: Record<string, (t: number) => void> = {
  careful: (t) => {
    const size = steer();
    steadyT = size <= DEPLOY.releaseLimit / 2 ? steadyT + DT : 0;
    flip = t > DEPLOY.introSeconds && reload <= 0 && steadyT >= 1 && flips < num('flips', DEPLOY.satellites);
  },
  hasty: (t) => {
    flip = t > DEPLOY.introSeconds && reload <= 0;
  },
  steer: () => {
    steer();
  },
  hold: () => {
    const l = lean();
    state.stickX = clamp(num('right', 0) - l.right);
    state.stickY = clamp(num('away', 0) - l.away);
  },
  nothing: () => {},
};
const pilot = pilots[q.get('pilot') ?? 'careful'] ?? (() => {});

const info: { log: string[]; maxLean: number; minCameraY: number } = { log: [], maxLean: 0, minCameraY: Infinity };
(window as unknown as { deployInfo: typeof info }).deployInfo = info;
stage.start();
steady.copy(ship.quaternion);
camera.updateMatrixWorld();
rest.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
const until = num('t', 0);
let t = 0;
let pips = 0;
while (t < until && stage.result() === undefined) {
  pilot(t);
  if (flip) {
    reload = DEPLOY.reloadSeconds;
    flips++;
  }
  stage.update(DT);
  world.update(DT);
  effects.update(DT, camera);
  reload -= DT;
  const lit = overlay.querySelectorAll('.pip.lit').length;
  if (flip) info.log.push(`${t.toFixed(2)}s flip lean=${Math.hypot(lean().right, lean().away).toFixed(1)}${lit > pips ? ' good' : ''}`);
  pips = lit;
  flip = false;
  t += DT;
  info.maxLean = Math.max(info.maxLean, Math.hypot(lean().right, lean().away));
  info.minCameraY = Math.min(info.minCameraY, camera.position.y);
}
if (q.has('close')) {
  ship.updateMatrixWorld();
  const slot = world.ship.payloadExit.position.clone().applyMatrix4(ship.matrixWorld);
  const out = world.ship.payloadExit.direction.clone().transformDirection(ship.matrixWorld);
  const side = new Vector3().crossVectors(new Vector3(0, 1, 0), out).normalize();
  camera.position.copy(slot).addScaledVector(out, 7).addScaledVector(side, 6).add(new Vector3(0, 5, 0));
  camera.lookAt(slot.addScaledVector(out, 1.5));
}
info.log.push(`end lean=${JSON.stringify(lean())} t=${t.toFixed(2)} result=${JSON.stringify(stage.result())}`);
const draw = (): void => {
  renderer.render(scene, camera);
  requestAnimationFrame(draw);
};
draw();
