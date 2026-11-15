import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureRenderer, createWorld } from '../src/world/index.ts';
import { createEffectsImpl } from '../src/world/effects.ts';

const renderer = new WebGLRenderer({ antialias: true });
configureRenderer(renderer);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 30000);
const world = createWorld(scene);
const effects = createEffectsImpl(scene);
const controls = new OrbitControls(camera, renderer.domElement);
const info = document.getElementById('info');
const { booster, ship, tower } = world;

const cycle = <T,>(list: readonly T[], current: T): T => list[(list.indexOf(current) + 1) % list.length] ?? current;
let boosterLit = 0, shipLit = 0, exhaustB = 0, exhaustS = 0, steam = 0, chop = 0, chopTarget = 0;
let lifting = false, climb = 0, paused = false, followTarget: (() => Vector3) | undefined;

/** Camera viewpoints: position and target, some following the rocket. */
const views: Record<string, () => [Vector3, Vector3]> = {
  '1': () => [new Vector3(28, 34, 75), new Vector3(0, 40, 0)],
  '2': () => [new Vector3(40, 85, 270), new Vector3(-5, 72, 0)],
  '3': () => [new Vector3(160, 900, 260), new Vector3(-10, 60, 0)],
  '4': () => [new Vector3(650, 260, 1950), new Vector3(0, 80, 0)],
  '5': () => [booster.object.position.clone().add(new Vector3(13, -11, 17)), booster.object.position.clone().add(new Vector3(0, 1, 0))],
  '6': () => [ship.object.position.clone().add(new Vector3(4, 18.5, 34)), ship.object.position.clone().add(new Vector3(0, 18.5, 0))],
  '7': () => [tower.catchPoint.clone().add(new Vector3(26, 4, 30)), tower.catchPoint.clone().add(new Vector3(0, -2, 0))],
  '8': () => [tower.catchPoint.clone().add(new Vector3(3, 32, 8)), tower.catchPoint.clone()],
  '9': () => [booster.object.position.clone().add(new Vector3(90, 20, 160)), booster.object.position.clone().add(new Vector3(0, 10, 0))],
};

function view(key: string): void {
  const v = views[key];
  if (!v) return;
  const [p, t] = v();
  camera.position.copy(p);
  controls.target.copy(t);
  followTarget = key === '9' ? () => booster.object.position.clone().add(new Vector3(0, 10, 0)) : undefined;
  controls.update();
}

function setEngines(n: number): void {
  boosterLit = n;
  booster.setEnginesLit(n);
}

function setShipEngines(n: number): void {
  shipLit = n;
  ship.setEnginesLit(n);
}

function setExhaust(b: number, s: number): void {
  exhaustB = b;
  exhaustS = s;
  effects.setExhaust(booster, b);
  effects.setExhaust(ship, s);
}

function setSteam(l: number): void {
  steam = l;
  effects.setPadSteam(l);
}

function reset(): void {
  world.resetToPad();
  effects.clear();
  lifting = false;
  climb = 0;
  boosterLit = shipLit = exhaustB = exhaustS = steam = 0;
  chop = chopTarget = 0;
}

function lift(on: boolean): void {
  lifting = on;
  if (on) {
    setEngines(33);
    setExhaust(1, 0);
    setSteam(1);
  }
}

function hang(): void {
  reset();
  booster.object.position.set(tower.catchPoint.x, tower.catchPoint.y - booster.catchPinHeight, tower.catchPoint.z);
  ship.object.visible = false;
}

function simulate(dt: number): void {
  if (lifting) {
    climb += dt * (4 + climb * 0.15);
    const dy = climb * dt;
    booster.object.position.y += dy;
    ship.object.position.y += dy;
    if (booster.object.position.y > 120) setSteam(0);
  }
  chop += Math.sign(chopTarget - chop) * Math.min(Math.abs(chopTarget - chop), dt / 1.5);
  tower.setChopsticks(chop);
  world.update(dt);
}

const MIN_CAMERA_HEIGHT = 2;

/** Holds the orbit target at or above the ground and the camera at least `MIN_CAMERA_HEIGHT` above it. */
function keepAboveGround(): void {
  controls.target.y = Math.max(controls.target.y, 0);
  if (camera.position.y < MIN_CAMERA_HEIGHT) camera.position.y = MIN_CAMERA_HEIGHT;
  camera.lookAt(controls.target);
}

const savedPos = new Vector3(), savedQuat = new Quaternion();
function render(dt: number): void {
  if (followTarget) {
    const t = followTarget();
    camera.position.add(t.clone().sub(controls.target));
    controls.target.copy(t);
  }
  controls.update();
  keepAboveGround();
  savedPos.copy(camera.position);
  savedQuat.copy(camera.quaternion);
  effects.update(dt, camera);
  renderer.render(scene, camera);
  camera.position.copy(savedPos);
  camera.quaternion.copy(savedQuat);
  const r = renderer.info.render;
  if (info)
    info.textContent =
      `calls ${r.calls}  triangles ${r.triangles}  particles ${effects.liveParticles()}  programs ${renderer.info.programs?.length ?? 0}\n` +
      `engines B ${boosterLit} S ${shipLit}  exhaust B ${exhaustB} S ${exhaustS}  steam ${steam}  chop ${chop.toFixed(2)}${paused ? '  PAUSED' : ''}\n` +
      `E/Q engines  X/Z exhaust  P steam  C chopsticks  L lift  H hang  B blast 100 m  N blast ground  K shake  R reset  1-9 views  Space pause`;
}

/** Advances the simulation by `seconds` in 1/60 s steps, then renders once. */
function step(seconds: number): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    simulate(1 / 60);
    if (i < n - 1) effects.update(1 / 60, camera);
  }
  render(1 / 60);
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k in views) view(k);
  else if (k === 'e') setEngines(cycle([0, 3, 13, 33], boosterLit));
  else if (k === 'q') setShipEngines(cycle([0, 3, 6], shipLit));
  else if (k === 'x') setExhaust(cycle([0, 0.5, 1], exhaustB), exhaustS);
  else if (k === 'z') setExhaust(exhaustB, cycle([0, 0.5, 1], exhaustS));
  else if (k === 'p') setSteam(cycle([0, 0.5, 1], steam));
  else if (k === 'c') chopTarget = chopTarget > 0.5 ? 0 : 1;
  else if (k === 'l') lift(!lifting);
  else if (k === 'h') hang();
  else if (k === 'b') effects.explode(new Vector3(-8, 100, 0));
  else if (k === 'n') effects.explode(new Vector3(60, 0, 60));
  else if (k === 'k') effects.shake(1);
  else if (k === 'r') reset();
  else if (k === ' ') paused = !paused;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused) return;
  simulate(dt);
  render(dt);
});

view('2');

/** Scripting hooks for headless screenshots. */
const harness = {
  view,
  engines: setEngines,
  shipEngines: setShipEngines,
  exhaust: setExhaust,
  steam: setSteam,
  chop(c: number) {
    chop = chopTarget = c;
    tower.setChopsticks(c);
  },
  lift,
  hang,
  reset,
  explode: (x: number, y: number, z: number) => effects.explode(new Vector3(x, y, z)),
  shake: (s: number) => effects.shake(s),
  pause: (p = true) => {
    paused = p;
  },
  step,
  raise: (dy: number) => {
    booster.object.position.y += dy;
    ship.object.position.y += dy;
  },
  separate: (dy: number) => {
    ship.object.position.y += dy;
  },
  tilt: (deg: number) => {
    booster.object.rotation.z = (deg * Math.PI) / 180;
    ship.object.rotation.z = (deg * Math.PI) / 180;
  },
  camera: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
    camera.position.set(px, py, pz);
    controls.target.set(tx, ty, tz);
    followTarget = undefined;
    controls.update();
  },
  /** Shakes for 2 s with and without re-placing the camera each frame; returns the peak and leftover offsets (metres plus radians). */
  shakeCheck: () => {
    const p0 = new Vector3(100, 50, 100);
    const run = (replace: boolean): [number, number] => {
      camera.position.copy(p0);
      camera.lookAt(0, 50, 0);
      const q0 = camera.quaternion.clone();
      effects.shake(1);
      let moved = 0;
      for (let i = 0; i < 120; i++) {
        if (replace) {
          camera.position.copy(p0);
          camera.quaternion.copy(q0);
        }
        effects.update(1 / 60, camera);
        moved = Math.max(moved, camera.position.distanceTo(p0) + camera.quaternion.angleTo(q0));
      }
      effects.update(1 / 60, camera);
      return [moved, camera.position.distanceTo(p0) + camera.quaternion.angleTo(q0)];
    };
    const [peakNoReplace, leftoverNoReplace] = run(false);
    const [peakReplace, leftoverReplace] = run(true);
    return { peakNoReplace, leftoverNoReplace, peakReplace, leftoverReplace };
  },
  geometry: () => ({ arms: tower.arms, footprint: tower.footprint, mountRadius: world.mountRadius, catchHalfWidth: tower.catchHalfWidth, catchPoint: tower.catchPoint }),
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, particles: effects.liveParticles(), programs: renderer.info.programs?.length ?? 0 }),
};
Object.assign(window, { h: harness });
