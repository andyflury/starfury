// Steps a catch stage under a scripted pilot to stage time `t`, then renders that moment.
//   /dev/catch.html?pilot=careful&t=40[&vehicle=ship&flip=200&tx=0&tz=0&final=2&drop=90&seed=1]
// window.catchCamera is the camera, to move by eval for close looks.
// Vehicles: booster (default), ship. The ship pilot flips with full throttle once its pins are `flip` metres above the catch point.
// Pilots: careful (to tx, tz, last 30 m at `final` m/s), low (throttle `throttle`), stall (full throttle), nothing (throttle 0), lowfuel (careful to 150 m, hover, throttle 0 from `drop` s).
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createAudio } from '../src/audio/index.ts';
import { createBoosterCatch, createShipCatch } from '../src/stages/catch.ts';
import { screenStick } from '../src/stages/catchSim.ts';
import { CATCH } from '../src/tuning.ts';
import type { Input, InputState } from '../src/types.ts';
import { createHud } from '../src/ui/hud.ts';
import '../src/ui/styles.css';
import { configureRenderer, createEffects, createWorld } from '../src/world/index.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const isShip = q.get('vehicle') === 'ship';

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
const state: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: true };
const input: Input = { state, poll() {}, confirm: false, flush() {}, source: 'keyboard', mapped: false };
const create = isShip ? createShipCatch : createBoosterCatch;
const stage = create({ scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay });
const vehicle = isShip ? world.ship : world.booster;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** The hull's middle, ignoring the lean: half the hull towards -X of the tail before the flip, above the base after it. */
const mid = (): Vector3 => vehicle.object.position.clone().add(flipped ? new Vector3(0, vehicle.height / 2, 0) : new Vector3(-vehicle.height / 2, 0, 0));
const prev = new Vector3();
const vel = new Vector3();
const pos = new Vector3();
const height = (): number => pos.y - vehicle.height / 2 + vehicle.catchPinHeight - world.tower.catchPoint.y;
let flipped = !isShip;

function careful(): void {
  const h = height();
  if (!flipped && h <= num('flip', 200)) flipped = true;
  const want = h > 300 ? 15 : h > 100 ? 8 : h > 30 ? 4 : num('final', 2);
  state.throttle = flipped ? clamp(CATCH.hoverThrottle * (1 - Math.sqrt(want / CATCH.fallSpeed)) + 0.05 * (-vel.y - want), 0, 1) : 0;
  const dx = num('tx', 0) - pos.x;
  const dz = num('tz', 0) - pos.z;
  const d = Math.hypot(dx, dz);
  const sp = Math.min(flipped ? 5 : 8, d * 0.3);
  const screen = screenStick(clamp(((d > 0 ? dx / d : 0) * sp - vel.x) * 0.6, -1, 1), -clamp(((d > 0 ? dz / d : 0) * sp - vel.z) * 0.6, -1, 1), -cameraYaw());
  state.stickX = screen.stickX;
  state.stickY = screen.stickY;
}

/** The camera's turn about +Y from facing -Z. */
function cameraYaw(): number {
  const f = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return Math.atan2(-f.x, -f.z);
}

/** How well stick right and stick up, as the stage turns them into the world, match the camera's screen right and away. */
function stickAlignment(): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
  const away = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
  const r = screenStick(1, 0, cameraYaw());
  const u = screenStick(0, 1, cameraYaw());
  return Math.min(r.stickX * right.x - r.stickY * right.z, u.stickX * away.x - u.stickY * away.z);
}

const pilots: Record<string, (t: number) => void> = {
  careful,
  low: () => {
    state.throttle = num('throttle', 0.2);
  },
  stall: () => {
    state.throttle = 1;
  },
  nothing: () => {
    state.throttle = 0;
  },
  lowfuel: (t) => {
    careful();
    if (height() < 150) state.throttle = t < num('drop', 90) ? CATCH.hoverThrottle : 0;
  },
};
const pilot = pilots[q.get('pilot') ?? 'careful'] ?? careful;

const DT = 1 / 60;
const info: { log: string[]; crashedAt?: number; minCameraY?: number; minAlign?: number; yawDeg?: number; screen?: object } = { log: [] };
(window as unknown as { catchInfo: typeof info; catchCamera: PerspectiveCamera }).catchInfo = info;
(window as unknown as { catchCamera: PerspectiveCamera }).catchCamera = camera;
stage.start();
const until = num('t', 0);
let t = 0;
pos.copy(mid());
prev.copy(pos);
while (t < until) {
  pilot(t);
  stage.update(DT);
  world.update(DT);
  effects.update(DT, camera);
  pos.copy(mid());
  vel.copy(pos).sub(prev).divideScalar(DT);
  prev.copy(pos);
  t += DT;
  if (!vehicle.object.visible && info.crashedAt === undefined) info.crashedAt = t;
  info.minCameraY = Math.min(info.minCameraY ?? Infinity, camera.position.y);
  info.minAlign = Math.min(info.minAlign ?? Infinity, stickAlignment());
  info.yawDeg = (cameraYaw() * 180) / Math.PI;
  if (Math.round(t * 60) % 300 === 0) info.log.push(`${t.toFixed(0)}s h=${height().toFixed(0)} x=${pos.x.toFixed(1)} z=${pos.z.toFixed(1)} vy=${vel.y.toFixed(1)} yaw=${((cameraYaw() * 180) / Math.PI).toFixed(0)} thr=${state.throttle.toFixed(2)} stick=${state.stickX.toFixed(2)},${state.stickY.toFixed(2)} vx=${vel.x.toFixed(1)} vz=${vel.z.toFixed(1)}`);
}
camera.updateMatrixWorld();
const top = vehicle.object.localToWorld(new Vector3(0, vehicle.height, 0)).project(camera);
const base = vehicle.object.position.clone().project(camera);
const ring = world.tower.catchPoint.clone().project(camera);
info.screen = { vehicleShare: Math.hypot(top.x - base.x, top.y - base.y) / 2, vehicleTop: [top.x, top.y], vehicleBase: [base.x, base.y], ring: [ring.x, ring.y] };
info.log.push(`end t=${t.toFixed(1)} h=${height().toFixed(1)} x=${pos.x.toFixed(1)} z=${pos.z.toFixed(1)}`);
const draw = (): void => {
  renderer.render(scene, camera);
  requestAnimationFrame(draw);
};
draw();
