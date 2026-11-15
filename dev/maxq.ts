// Steps the Max-Q stage under a scripted pilot, then renders that moment.
//   /dev/maxq.html?pilot=careful&seed=1   then in the page: h.step(seconds) and h.info()
// Pilots: careful (eases on the cue, steers to each ring), late (eases after the overload warning), nothing (full
// throttle, no stick), ignore (careful throttle, no stick). A twin simulation fed the same input gives the pilot the rings.
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createAudio } from '../src/audio/index.ts';
import { createMaxqStage } from '../src/stages/maxq.ts';
import { createMaxq, type MaxqEvent, stepMaxq } from '../src/stages/maxqSim.ts';
import { MAXQ } from '../src/tuning.ts';
import type { Input, InputState } from '../src/types.ts';
import { createHud } from '../src/ui/hud.ts';
import '../src/ui/styles.css';
import { configureRenderer, createEffects, createWorld } from '../src/world/index.ts';

const q = new URLSearchParams(location.search);
const pilotName = q.get('pilot') ?? 'careful';
const seed0 = Number(q.get('seed') ?? 1) >>> 0;
let seed = seed0;
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
const state: InputState = { throttle: 1, stickX: 0, stickY: 0, armed: true };
const input: Input = { state, poll() {}, confirm: false, flush() {}, source: 'keyboard', mapped: false };
const stage = createMaxqStage({ scene, camera, world, effects, input, voice: audio.voice, sfx: audio.sfx, hud, overlay });

seed = seed0;
stage.start();
seed = seed0;
const twin = createMaxq(Math.random);

let easeAt = Infinity;
let fullAt = Infinity;
let want = 1;
const steer = pilotName === 'careful' || pilotName === 'late';
const trigger = pilotName === 'late' ? 'overload' : pilotName === 'nothing' ? 'none' : 'ease';
const stick = (v: number): number => Math.max(-0.55, Math.min(0.55, Math.abs(v) < 3 ? 0 : v / 22));

/** Sets the input for the next step from the twin and the events of the last step. */
function pilot(events: MaxqEvent[]): void {
  for (const e of events) {
    if (e.kind === trigger && easeAt === Infinity) easeAt = twin.t + (trigger === 'ease' ? 3.5 : 0.8);
    if (e.kind === 'full' && trigger !== 'none') fullAt = twin.t + 2.5;
  }
  if (twin.t >= fullAt) want = 1;
  else if (twin.t >= easeAt) want = 0.55;
  state.throttle += Math.max(-1.5 / 60, Math.min(1.5 / 60, want - state.throttle));
  const ring = twin.rings[twin.next];
  state.stickX = steer && ring ? stick(ring.x - twin.x) : 0;
  state.stickY = steer && ring ? -stick(ring.y - twin.y) : 0;
}

/** Whether a corner of the tower's box lies inside the camera's view. */
function towerVisible(): boolean {
  camera.updateMatrixWorld();
  const fp = world.tower.footprint;
  return [fp.minX, fp.maxX].some((x) =>
    [-fp.halfZ, fp.halfZ].some((z) =>
      [0, fp.top].some((y) => {
        const n = new Vector3(x, y, z).project(camera);
        return n.z < 1 && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1;
      }),
    ),
  );
}

const DT = 1 / 60;
/** Frames so far in which the tower was in view. */
let towerFrames = 0;
let events: MaxqEvent[] = [];
const log: string[] = [];

/** Scripting hooks for headless screenshots. */
const harness = {
  input: state,
  /** Steps `seconds` of stage time under the pilot, or with the input held when `hold` is true, and renders. */
  step(seconds: number, hold = false) {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      if (!hold) pilot(events);
      events = stepMaxq(twin, DT, state);
      for (const e of events) log.push(`${twin.t.toFixed(1)}:${e.kind}${e.kind === 'ring' ? (e.hit ? '+' : '-') : ''}`);
      stage.update(DT);
      world.update(DT);
      effects.update(DT, camera);
      if (towerVisible()) towerFrames++;
    }
    renderer.render(scene, camera);
    return harness.info();
  },
  /** Where the run is, and where the rocket and the next ring are on screen (-1 to 1). */
  info() {
    camera.updateMatrixWorld();
    const ring = twin.rings[twin.next];
    const b = world.booster.object;
    const nose = new Vector3(0, world.booster.height + world.ship.height, 0).applyQuaternion(b.quaternion).add(b.position);
    const p = (v: Vector3): [number, number] => {
      const n = v.clone().project(camera);
      return [Math.round(n.x * 100) / 100, Math.round(n.y * 100) / 100];
    };
    const r = (v: number): number => Math.round(v * 100) / 100;
    return {
      t: r(twin.t),
      phase: twin.phase,
      air: twin.air,
      pressure: r(twin.pressure),
      stress: r(twin.stress),
      hits: twin.hits,
      next: twin.next,
      toRing: ring ? Math.round(ring.s - twin.s) : undefined,
      throttle: r(state.throttle),
      base: p(b.position),
      nose: p(nose),
      cameraY: Math.round(camera.position.y),
      towerFrames,
      result: stage.result(),
      log: log.join(' '),
    };
  },
  ringRadius: MAXQ.ringRadius,
};
Object.assign(window, { h: harness });
renderer.render(scene, camera);
