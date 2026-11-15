// Steps the re-entry stage under a scripted pilot to stage time `t`, then renders that moment.
//   /dev/reentry.html?pilot=careful&t=20[&aim=30&from=15&seed=1]
// Pilots: careful (holds the attitude, from `from` s rolled `aim` degrees right), slow (late and gentle), nothing (no stick).
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createAudio } from '../src/audio/index.ts';
import { createReentryStage } from '../src/stages/reentry.ts';
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
const state: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: true };
const input: Input = { state, poll() {}, confirm: false, flush() {}, source: 'keyboard', mapped: false };
const stage = createReentryStage({ scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay });

/** The ship's drawn roll (right side down) and pitch (nose down) in degrees, as the tilt level shows them. */
function attitude(): { roll: number; pitch: number } {
  const q = world.ship.object.quaternion;
  const right = new Vector3(1, 0, 0).applyQuaternion(q);
  const nose = new Vector3(0, 1, 0).applyQuaternion(q);
  return { roll: Math.asin(-right.y) * (180 / Math.PI), pitch: Math.asin(-nose.y) * (180 / Math.PI) };
}

const DT = 1 / 60;
const seen: { roll: number; pitch: number }[] = [];
/** Steers towards `aim` degrees of roll, seeing the attitude `delay` s late, ignoring `dead` degrees, stick `cap` at `dead + full`. */
function steer(aim: number, delay: number, dead: number, full: number, cap: number): void {
  seen.push(attitude());
  const e = seen[Math.max(0, seen.length - 1 - Math.round(delay / DT))] ?? { roll: 0, pitch: 0 };
  const roll = e.roll - aim;
  const size = Math.hypot(roll, e.pitch);
  const k = size < dead ? 0 : Math.min(cap, (size - dead) / full) / size;
  state.stickX = -roll * k;
  state.stickY = -e.pitch * k;
}

const pilots: Record<string, (t: number) => void> = {
  careful: (t) => steer(t >= num('from', Infinity) ? num('aim', 0) : 0, 0.4, 2, 8, 0.8),
  slow: () => steer(0, 1.5, 8, 20, 0.4),
  nothing: () => {},
};
const pilot = pilots[q.get('pilot') ?? 'careful'] ?? pilots.careful;

const info: { log: string[]; result?: unknown; burnedAt?: number } = { log: [] };
(window as unknown as { reentryInfo: typeof info }).reentryInfo = info;
stage.start();
const until = num('t', 0);
let t = 0;
while (t < until) {
  pilot?.(t);
  stage.update(DT);
  world.update(DT);
  effects.update(DT, camera);
  t += DT;
  if (!world.ship.object.visible && info.burnedAt === undefined) info.burnedAt = t;
  if (Math.round(t * 60) % 120 === 0) {
    const e = attitude();
    info.log.push(`${t.toFixed(0)}s roll=${e.roll.toFixed(1)} pitch=${e.pitch.toFixed(1)} stick=${state.stickX.toFixed(2)},${state.stickY.toFixed(2)}`);
  }
}
info.result = stage.result();
const draw = (): void => {
  renderer.render(scene, camera);
  requestAnimationFrame(draw);
};
draw();
