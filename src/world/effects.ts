import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { Effects, Vehicle } from '../types.ts';
import { canvas2d, particleFloor, rng } from './starbase.ts';

/** One particle's launch parameters; reused for every spawn. */
interface Spawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds before the particle appears. */
  delay: number;
  life: number;
  size0: number;
  size1: number;
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  alpha: number;
  /** Velocity decay per second. */
  drag: number;
  /** Upward acceleration, m/s². */
  lift: number;
  /** Fraction of the life over which the particle fades in. */
  fadeIn: number;
  spin: number;
}

const sp: Spawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, delay: 0, life: 1, size0: 1, size1: 1, r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, alpha: 1, drag: 0, lift: 0, fadeIn: 0.1, spin: 0 };

const PARTICLE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSR;
attribute vec4 iCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
void main() {
  vUv = uv;
  vCol = iCol;
  vShade = position.y + 0.5;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSR.y), s = sin(iSR.y);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSR.x;
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uShade;
uniform float uOcclude;
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
void main() {
  float a = texture2D(uMap, vUv).a * vCol.a;
  if (a < 0.004) discard;
  vec3 col = vCol.rgb * mix(1.0, 0.72 + 0.28 * vShade, uShade);
  gl_FragColor = vec4(col * a, a * uOcclude);
}`;

/** A soft lumpy puff in the alpha channel: Gaussian lumps under a smooth round falloff. */
function puffTexture(): CanvasTexture {
  const size = 128;
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const rand = rng(17);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2, d = rand() * 0.45;
    lumps.push([Math.cos(a) * d, Math.sin(a) * d, 0.18 + rand() * 0.2]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1, v = ((y + 0.5) / size) * 2 - 1;
      const r2 = u * u + v * v;
      let lump = 0;
      for (const [lx, ly, s] of lumps) lump += Math.exp(-((u - lx) ** 2 + (v - ly) ** 2) / (s * s));
      const fall = r2 < 1 ? (1 - r2) * (1 - r2) : 0;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, fall * (0.45 + 0.55 * Math.min(1, lump * 0.6)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new CanvasTexture(c);
}

/** A fixed-size ring buffer of camera-facing particles drawn in one call; the oldest is replaced when full. */
class Pool {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly cap: number;
  private next = 0;
  private high = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly alpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly lift: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly aPos: InstancedBufferAttribute;
  private readonly aSR: InstancedBufferAttribute;
  private readonly aCol: InstancedBufferAttribute;
  private readonly attrs: InstancedBufferAttribute[];

  constructor(cap: number, map: CanvasTexture, shade: number, occlude: number, renderOrder: number) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.c0 = new Float32Array(cap * 3);
    this.c1 = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.lift = new Float32Array(cap);
    this.fadeIn = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.setIndex(quad.index);
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(DynamicDrawUsage);
    this.aSR = new InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(DynamicDrawUsage);
    this.aCol = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSR', this.aSR);
    g.setAttribute('iCol', this.aCol);
    this.attrs = [this.aPos, this.aSR, this.aCol];
    g.instanceCount = 0;
    this.geometry = g;
    const mat = new ShaderMaterial({
      uniforms: { uMap: { value: map }, uShade: { value: shade }, uOcclude: { value: occlude } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  spawn(s: Spawn): void {
    const i = this.next;
    this.next = (i + 1) % this.cap;
    if (i + 1 > this.high) this.high = i + 1;
    const i3 = i * 3;
    this.pos[i3] = s.x;
    this.pos[i3 + 1] = s.y;
    this.pos[i3 + 2] = s.z;
    this.vel[i3] = s.vx;
    this.vel[i3 + 1] = s.vy;
    this.vel[i3 + 2] = s.vz;
    this.c0[i3] = s.r0;
    this.c0[i3 + 1] = s.g0;
    this.c0[i3 + 2] = s.b0;
    this.c1[i3] = s.r1;
    this.c1[i3 + 1] = s.g1;
    this.c1[i3 + 2] = s.b1;
    this.age[i] = -s.delay;
    this.life[i] = s.life;
    this.s0[i] = s.size0;
    this.s1[i] = s.size1;
    this.alpha[i] = s.alpha;
    this.drag[i] = s.drag;
    this.lift[i] = s.lift;
    this.fadeIn[i] = Math.max(0.001, s.fadeIn);
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = s.spin;
  }

  /** Number of particles alive or waiting to appear. */
  live(): number {
    let n = 0;
    for (let i = 0; i < this.high; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  update(dt: number): void {
    const { pos, vel, age, life } = this;
    const ap = this.aPos.array as Float32Array, asr = this.aSR.array as Float32Array, ac = this.aCol.array as Float32Array;
    let last = -1;
    for (let i = 0; i < this.high; i++) {
      const l = life[i]!;
      const i2 = i * 2;
      if (l <= 0) {
        asr[i2] = 0;
        continue;
      }
      const a = age[i]! + dt;
      age[i] = a;
      if (a >= l) {
        life[i] = 0;
        asr[i2] = 0;
        continue;
      }
      last = i;
      if (a < 0) {
        asr[i2] = 0;
        continue;
      }
      const i3 = i * 3, i4 = i * 4;
      const t = a / l;
      const k = Math.exp(-this.drag[i]! * dt);
      const vx = vel[i3]! * k, vy = vel[i3 + 1]! * k + this.lift[i]! * dt, vz = vel[i3 + 2]! * k;
      const u = 1 - t;
      const size = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * (1 - u * u);
      const px = pos[i3]! + vx * dt;
      let py = pos[i3 + 1]! + vy * dt;
      const pz = pos[i3 + 2]! + vz * dt;
      let nvy = vy;
      const minY = particleFloor.y + size * 0.3;
      if (py < minY) {
        py = minY;
        if (nvy < 0) nvy = 0;
      }
      pos[i3] = px;
      pos[i3 + 1] = py;
      pos[i3 + 2] = pz;
      vel[i3] = vx;
      vel[i3 + 1] = nvy;
      vel[i3 + 2] = vz;
      this.rot[i] = this.rot[i]! + this.spin[i]! * dt;
      ap[i3] = px;
      ap[i3 + 1] = py;
      ap[i3 + 2] = pz;
      asr[i2] = size;
      asr[i2 + 1] = this.rot[i]!;
      ac[i4] = this.c0[i3]! + (this.c1[i3]! - this.c0[i3]!) * t;
      ac[i4 + 1] = this.c0[i3 + 1]! + (this.c1[i3 + 1]! - this.c0[i3 + 1]!) * t;
      ac[i4 + 2] = this.c0[i3 + 2]! + (this.c1[i3 + 2]! - this.c0[i3 + 2]!) * t;
      ac[i4 + 3] = this.alpha[i]! * Math.min(1, t / this.fadeIn[i]!) * (1 - t * t);
    }
    this.high = last + 1;
    if (this.next > this.high && this.high === 0) this.next = 0;
    this.geometry.instanceCount = this.high;
    for (let k = 0; k < this.attrs.length; k++) {
      const attr = this.attrs[k]!;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.high * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.high = 0;
    this.next = 0;
    this.geometry.instanceCount = 0;
  }
}

const PLUME_VERT = /* glsl */ `
varying float vT;
varying float vA;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = -position.y;
  vA = atan(position.z, position.x);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const PLUME_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uTime;
uniform float uIntensity;
uniform float uDiamonds;
uniform float uDiamondAmount;
uniform float uFall;
uniform vec3 uColA;
uniform vec3 uColB;
varying float vT;
varying float vA;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(facing, 0.8);
  float along = pow(max(0.0, 1.0 - vT), uFall) * smoothstep(0.0, 0.03, vT);
  float d = 0.5 + 0.5 * cos(vT * uDiamonds * 6.2832);
  float diamonds = mix(1.0, 0.35 + 0.9 * d, uDiamondAmount * (1.0 - smoothstep(0.35, 0.85, vT)));
  float flick = 0.86 + 0.14 * sin(uTime * 41.0 + vT * 23.0 + vA * 5.0) * sin(uTime * 17.0 + vA * 3.0 - vT * 9.0);
  vec3 col = mix(uColA, uColB, clamp(vT * 1.3 + (1.0 - facing) * 0.45, 0.0, 1.0));
  gl_FragColor = vec4(col * body * along * diamonds * flick * uIntensity * uLevel, 1.0);
}`;

/** A unit plume surface of revolution from y = 0 down to y = -1 with radius `r(t)`. */
function plumeGeometry(r: (t: number) => number, rows: number): LatheGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    pts.push(new Vector2(Math.max(0.01, r(t)), -t));
  }
  return new LatheGeometry(pts, 20);
}

const outerGeometry = plumeGeometry((t) => 1 + 0.9 * Math.pow(t, 0.8), 18);
const coreGeometry = plumeGeometry((t) => 0.78 * (1 - 0.4 * t) * (0.8 + 0.2 * Math.cos(t * Math.PI * 2 * 4)), 48);

function plumeMaterial(colA: Color, colB: Color, intensity: number, diamonds: number, diamondAmount: number, fall: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLevel: { value: 0 },
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uDiamonds: { value: diamonds },
      uDiamondAmount: { value: diamondAmount },
      uFall: { value: fall },
      uColA: { value: colA },
      uColB: { value: colB },
    },
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

interface Plume {
  vehicle: Vehicle;
  group: Group;
  outer: Mesh;
  core: Mesh;
  outerMat: ShaderMaterial;
  coreMat: ShaderMaterial;
  level: number;
  length: number;
  width: number;
  fireAcc: number;
  smokeAcc: number;
}

const VAPOR_VERT = /* glsl */ `
varying float vT;
varying float vA;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = -position.y;
  vA = atan(position.z, position.x);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const VAPOR_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uTime;
varying float vT;
varying float vA;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float streak = (0.5 + 0.5 * sin(vA * 13.0 + 2.0 * sin(vA * 5.0 + uTime * 3.0))) * (0.6 + 0.4 * sin(vA * 29.0 - uTime * 2.0));
  float flow = 0.55 + 0.45 * sin(vT * 16.0 - uTime * 14.0 + vA * 7.0);
  float along = smoothstep(0.0, 0.06, vT) * pow(max(0.0, 1.0 - vT), 1.3);
  float flick = 0.82 + 0.18 * sin(uTime * 23.0 + vA * 3.0);
  float a = min(1.0, uLevel * along * (0.45 + 0.75 * streak * flow) * flick * (0.8 + 0.6 * (1.0 - facing)));
  gl_FragColor = vec4(vec3(0.97, 0.98, 1.0) * (0.86 + 0.14 * facing), a);
}`;

const SHEATH_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SHEATH_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uTime;
uniform vec3 uFrom;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec3 n = normalize(vN);
  float wind = max(0.0, dot(n, uFrom));
  float rim = 1.0 - abs(dot(n, normalize(vV)));
  float flick = 0.8 + 0.2 * sin(uTime * 31.0 + vP.y * 9.0 + vP.x * 5.0) * sin(uTime * 13.0 - vP.z * 7.0);
  float g = uLevel * pow(wind, 0.9) * (0.7 + 1.6 * rim) * flick;
  vec3 col = mix(vec3(1.0, 0.45, 0.14), vec3(1.0, 0.38, 0.62), clamp(rim * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col * g, 1.0);
}`;

const WAKE_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uTime;
varying float vT;
varying float vA;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float lines = pow(0.5 + 0.5 * sin(vA * 11.0 + 1.5 * sin(vT * 4.0 + vA * 3.0)), 5.0);
  float flow = 0.5 + 0.5 * sin(vT * 22.0 - uTime * 26.0 + vA * 5.0);
  float along = smoothstep(0.0, 0.08, vT) * pow(max(0.0, 1.0 - vT), 1.6);
  float g = uLevel * along * (0.15 + 0.85 * lines * flow) * pow(facing, 0.7);
  vec3 col = mix(vec3(1.0, 0.42, 0.12), vec3(0.95, 0.25, 0.5), vT);
  gl_FragColor = vec4(col * g * 0.8, 1.0);
}`;

/** A unit collar from radius 1.04 at y = 0 flaring down to y = -1. */
const vaporGeometry = plumeGeometry((t) => 1.04 + 1.5 * Math.pow(t, 0.6), 16);
/** A unit wake from radius 1 at y = 0 narrowing to y = -1. */
const wakeGeometry = plumeGeometry((t) => 1 - 0.65 * t, 12);
const sheathGeometry = new SphereGeometry(1, 32, 20);

interface Vapor {
  vehicle: Vehicle;
  mesh: Mesh;
  material: ShaderMaterial;
  level: number;
  acc: number;
}

interface Plasma {
  vehicle: Vehicle;
  sheath: Mesh;
  sheathMat: ShaderMaterial;
  wake: Mesh;
  wakeMat: ShaderMaterial;
  level: number;
  from: Vector3;
  acc: number;
}

const DEBRIS = 40;

/** Builds the particle pools, plumes, vapour, plasma, debris and camera shake and adds them to the scene. */
export function createEffectsImpl(scene: Scene): Effects & { liveParticles(): number } {
  const map = puffTexture();
  const smoke = new Pool(1500, map, 0.5, 1, 10);
  const fire = new Pool(1000, map, 0, 0.4, 11);
  scene.add(smoke.mesh, fire.mesh);

  const plumes = new Map<Vehicle, Plume>();
  const plumeList: Plume[] = [];
  let steam = 0, steamAcc = 0, time = 0;

  const debrisMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.9 });
  const debris = new InstancedMesh(new BoxGeometry(1, 1, 1), debrisMat, DEBRIS);
  debris.frustumCulled = false;
  debris.count = 0;
  debris.castShadow = true;
  const steelCol = new Color(0xc2c6cb), tileCol = new Color(0x1c1d20);
  for (let i = 0; i < DEBRIS; i++) debris.setColorAt(i, i % 3 === 0 ? tileCol : steelCol);
  scene.add(debris);
  const dPos = new Float32Array(DEBRIS * 3), dVel = new Float32Array(DEBRIS * 3), dAxis = new Float32Array(DEBRIS * 3), dSize = new Float32Array(DEBRIS * 3);
  const dAge = new Float32Array(DEBRIS), dLife = new Float32Array(DEBRIS), dAngle = new Float32Array(DEBRIS), dSpin = new Float32Array(DEBRIS);
  let dNext = 0;

  const v1 = new Vector3(), v2 = new Vector3(), m4 = new Matrix4(), q = new Quaternion(), sc = new Vector3();
  const basePos = new Vector3(), baseQuat = new Quaternion(), appliedPos = new Vector3(), appliedQuat = new Quaternion();
  let shakeAmp = 0, shakeApplied = false;

  const vapors = new Map<Vehicle, Vapor>();
  const vaporList: Vapor[] = [];
  const plasmas = new Map<Vehicle, Plasma>();
  const plasmaList: Plasma[] = [];
  const m3 = new Matrix3(), localFrom = new Vector3(), axis = new Vector3(), wq = new Quaternion(), yAxis = new Vector3(0, 1, 0);

  const vaporFor = (vehicle: Vehicle): Vapor => {
    let v = vapors.get(vehicle);
    if (!v) {
      const material = new ShaderMaterial({
        uniforms: { uLevel: { value: 0 }, uTime: { value: 0 } },
        vertexShader: VAPOR_VERT,
        fragmentShader: VAPOR_FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(vaporGeometry, material);
      mesh.renderOrder = 14;
      v = { vehicle, mesh, material, level: 0, acc: 0 };
      vapors.set(vehicle, v);
      vaporList.push(v);
    }
    return v;
  };

  const plasmaFor = (vehicle: Vehicle): Plasma => {
    let p = plasmas.get(vehicle);
    if (!p) {
      const uniforms = (): Record<string, { value: unknown }> => ({ uLevel: { value: 0 }, uTime: { value: 0 }, uFrom: { value: new Vector3() } });
      const sheathMat = new ShaderMaterial({ uniforms: uniforms(), vertexShader: SHEATH_VERT, fragmentShader: SHEATH_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending });
      const wakeMat = new ShaderMaterial({ uniforms: uniforms(), vertexShader: VAPOR_VERT, fragmentShader: WAKE_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
      const sheath = new Mesh(sheathGeometry, sheathMat);
      const wake = new Mesh(wakeGeometry, wakeMat);
      sheath.renderOrder = 15;
      wake.renderOrder = 15;
      wake.frustumCulled = false;
      p = { vehicle, sheath, sheathMat, wake, wakeMat, level: 0, from: new Vector3(0, -1, 0), acc: 0 };
      plasmas.set(vehicle, p);
      plasmaList.push(p);
    }
    return p;
  };

  const updateVapor = (v: Vapor, dt: number): void => {
    if (v.level <= 0) return;
    const { vehicle } = v;
    const y = vehicle.height * 0.75;
    v.mesh.position.set(0, y, 0);
    v.mesh.scale.set(vehicle.radius, vehicle.height * 0.45 * (0.6 + 0.4 * v.level), vehicle.radius);
    v.material.uniforms.uLevel!.value = v.level;
    v.material.uniforms.uTime!.value = time;
    vehicle.object.updateWorldMatrix(true, false);
    v.acc += dt * v.level * 45;
    while (v.acc >= 1) {
      v.acc -= 1;
      const a = Math.random() * Math.PI * 2, r = vehicle.radius * (1.1 + Math.random() * 0.5);
      fromVehicle(vehicle, Math.cos(a) * r, y - Math.random() * vehicle.height * 0.2, Math.sin(a) * r, Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3, 8 + Math.random() * 8);
      sp.delay = 0;
      sp.life = 0.5 + Math.random() * 0.4;
      sp.size0 = vehicle.radius * 0.8;
      sp.size1 = vehicle.radius * 2;
      colors(0.98, 0.99, 1, 0.95, 0.96, 0.98);
      sp.alpha = 0.6 * v.level;
      sp.drag = 1;
      sp.lift = 0;
      sp.fadeIn = 0.1;
      sp.spin = (Math.random() - 0.5) * 2;
      smoke.spawn(sp);
    }
  };

  const updatePlasma = (p: Plasma, dt: number, camera: PerspectiveCamera): void => {
    if (p.level <= 0) return;
    const { vehicle } = p;
    const H = vehicle.height, R = vehicle.radius;
    vehicle.object.updateWorldMatrix(true, false);
    p.sheath.position.set(0, H / 2, 0);
    p.sheath.scale.set(R * 1.3, H * 0.56, R * 1.3);
    m3.setFromMatrix4(camera.matrixWorldInverse);
    const fromView = p.sheathMat.uniforms.uFrom!.value as Vector3;
    fromView.copy(p.from).applyMatrix3(m3).normalize();
    p.sheathMat.uniforms.uLevel!.value = p.level;
    p.sheathMat.uniforms.uTime!.value = time;
    p.wakeMat.uniforms.uLevel!.value = p.level;
    p.wakeMat.uniforms.uTime!.value = time;
    vehicle.object.getWorldQuaternion(wq);
    axis.copy(yAxis).applyQuaternion(wq);
    const sinA = axis.cross(p.from).length();
    const perp = Math.max(R, 0.5 * H * sinA) * 1.15;
    vehicle.object.localToWorld(p.wake.position.set(0, H / 2, 0));
    p.wake.quaternion.setFromUnitVectors(yAxis, p.from);
    p.wake.scale.set(perp, perp * (1.5 + 3 * p.level), perp);
    localFrom.copy(p.from).applyQuaternion(wq.invert());
    p.acc += dt * p.level * 140;
    while (p.acc >= 1) {
      p.acc -= 1;
      let a = 0;
      for (let k = 0; k < 6; k++) {
        a = Math.random() * Math.PI * 2;
        if (Math.sin(a) * localFrom.x + Math.cos(a) * localFrom.z > 0.2) break;
      }
      fromVehicle(vehicle, Math.sin(a) * R * 1.2, H * (0.05 + Math.random() * 0.9), Math.cos(a) * R * 1.2, -localFrom.x, -localFrom.y, -localFrom.z, 50 + Math.random() * 50);
      sp.delay = 0;
      sp.life = 0.35 + Math.random() * 0.35;
      sp.size0 = 2 + Math.random() * 2;
      sp.size1 = 5 + Math.random() * 4;
      colors(1, 0.6, 0.4, 0.9, 0.22, 0.35);
      sp.alpha = 0.6 * p.level;
      sp.drag = 0.5;
      sp.lift = 0;
      sp.fadeIn = 0.1;
      sp.spin = 0;
      fire.spawn(sp);
    }
  };

  const plumeFor = (vehicle: Vehicle): Plume => {
    let p = plumes.get(vehicle);
    if (!p) {
      const outerMat = plumeMaterial(new Color(1.0, 0.72, 0.38), new Color(0.95, 0.36, 0.1), 0.6, 3, 0.4, 1.2);
      const coreMat = plumeMaterial(new Color(1.0, 0.93, 0.78), new Color(1.0, 0.62, 0.28), 0.8, 4, 1, 0.9);
      const outer = new Mesh(outerGeometry, outerMat);
      const core = new Mesh(coreGeometry, coreMat);
      outer.renderOrder = 12;
      core.renderOrder = 13;
      const group = new Group();
      group.add(outer, core);
      p = { vehicle, group, outer, core, outerMat, coreMat, level: 0, length: 0, width: 0, fireAcc: 0, smokeAcc: 0 };
      plumes.set(vehicle, p);
      plumeList.push(p);
    }
    return p;
  };

  /** Writes a point of the vehicle's local frame into sp.x/y/z and a local direction times `speed` into sp.vx/vy/vz. */
  const fromVehicle = (vehicle: Vehicle, lx: number, ly: number, lz: number, dx: number, dy: number, dz: number, speed: number): void => {
    const mw = vehicle.object.matrixWorld;
    v1.set(lx, ly, lz).applyMatrix4(mw);
    v2.set(dx, dy, dz).transformDirection(mw).multiplyScalar(speed);
    sp.x = v1.x;
    sp.y = v1.y;
    sp.z = v1.z;
    sp.vx = v2.x;
    sp.vy = v2.y;
    sp.vz = v2.z;
  };

  const colors = (r0: number, g0: number, b0: number, r1: number, g1: number, b1: number): void => {
    sp.r0 = r0;
    sp.g0 = g0;
    sp.b0 = b0;
    sp.r1 = r1;
    sp.g1 = g1;
    sp.b1 = b1;
  };

  const updatePlume = (p: Plume, dt: number): void => {
    const { vehicle, level } = p;
    p.group.visible = level > 0;
    if (level <= 0) return;
    const n = vehicle.engineCount;
    const flick = 1 + 0.04 * Math.sin(time * 23) + 0.03 * Math.sin(time * 41 + 1);
    p.width = vehicle.radius * (0.8 + 0.3 * level);
    p.length = vehicle.radius * (2 + 2.6 * Math.sqrt(n)) * (0.3 + 0.7 * level) * flick;
    p.outer.scale.set(p.width, p.length, p.width);
    p.core.scale.set(p.width, p.length * 0.5, p.width);
    p.outerMat.uniforms.uLevel!.value = Math.min(1, 0.35 + level);
    p.coreMat.uniforms.uLevel!.value = Math.min(1, 0.35 + level);
    p.outerMat.uniforms.uTime!.value = time;
    p.coreMat.uniforms.uTime!.value = time;
    vehicle.object.updateWorldMatrix(true, false);
    const w = p.width, L = p.length;
    p.fireAcc += dt * level * (30 + n * 3);
    while (p.fireAcc >= 1) {
      p.fireAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * w * 0.55;
      fromVehicle(vehicle, Math.cos(a) * r, -L * (0.25 + Math.random() * 0.5), Math.sin(a) * r, (Math.random() - 0.5) * 0.2, -1, (Math.random() - 0.5) * 0.2, 25 + Math.random() * 20);
      sp.delay = 0;
      sp.life = 0.25 + Math.random() * 0.2;
      sp.size0 = w * 1.0;
      sp.size1 = w * 2.4;
      colors(1, 0.8, 0.5, 0.8, 0.3, 0.08);
      sp.alpha = 0.3;
      sp.drag = 1.5;
      sp.lift = 3;
      sp.fadeIn = 0.1;
      sp.spin = (Math.random() - 0.5) * 2;
      fire.spawn(sp);
    }
    if (level > 0.45) {
      p.smokeAcc += dt * ((level - 0.45) / 0.55) * (12 + n * 1.2);
      while (p.smokeAcc >= 1) {
        p.smokeAcc -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * w * 0.5;
        fromVehicle(vehicle, Math.cos(a) * r, -L * (0.7 + Math.random() * 0.35), Math.sin(a) * r, (Math.random() - 0.5) * 0.6, -1, (Math.random() - 0.5) * 0.6, 6 + Math.random() * 6);
        sp.delay = 0;
        sp.life = 6 + Math.random() * 3;
        sp.size0 = w * 1.6;
        sp.size1 = w * (6 + Math.random() * 3);
        const g = 0.94 + Math.random() * 0.05;
        colors(g, g, g - 0.02, g - 0.06, g - 0.06, g - 0.05);
        sp.alpha = 0.6;
        sp.drag = 0.5;
        sp.lift = 0.6;
        sp.fadeIn = 0.06;
        sp.spin = (Math.random() - 0.5) * 0.4;
        smoke.spawn(sp);
      }
    }
  };

  const emitSteam = (dt: number): void => {
    if (steam <= 0) return;
    steamAcc += dt * steam * 170;
    while (steamAcc >= 1) {
      steamAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 7, s = 16 + Math.random() * 24;
      sp.x = Math.cos(a) * r;
      sp.y = 1 + Math.random() * 6;
      sp.z = Math.sin(a) * r;
      sp.vx = Math.cos(a) * s;
      sp.vy = 1 + Math.random() * 5;
      sp.vz = Math.sin(a) * s;
      sp.delay = 0;
      sp.life = 3.5 + Math.random() * 2.5;
      sp.size0 = 7 + Math.random() * 5;
      sp.size1 = 30 + Math.random() * 25;
      if (Math.random() < 0.3) colors(0.9, 0.84, 0.74, 0.86, 0.82, 0.76);
      else colors(0.99, 0.99, 0.98, 0.9, 0.9, 0.9);
      sp.alpha = 0.6;
      sp.drag = 0.7;
      sp.lift = 2;
      sp.fadeIn = 0.05;
      sp.spin = (Math.random() - 0.5) * 0.6;
      smoke.spawn(sp);
    }
  };

  /** A random unit direction into v1, folded upward when `up`. */
  const randomDir = (up: boolean): Vector3 => {
    v1.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (v1.lengthSq() < 1e-4) v1.set(0, 1, 0);
    v1.normalize();
    if (up) v1.y = Math.abs(v1.y) * 0.8 + 0.2;
    return v1.normalize();
  };

  const updateDebris = (dt: number): void => {
    let last = -1;
    for (let i = 0; i < DEBRIS; i++) {
      if (dLife[i]! <= 0) continue;
      const a = dAge[i]! + dt;
      dAge[i] = a;
      if (a >= dLife[i]!) {
        dLife[i] = 0;
        debris.setMatrixAt(i, m4.makeScale(0, 0, 0));
        continue;
      }
      last = i;
      const i3 = i * 3;
      dVel[i3 + 1] = dVel[i3 + 1]! - 14 * dt;
      const x = dPos[i3]! + dVel[i3]! * dt, z = dPos[i3 + 2]! + dVel[i3 + 2]! * dt;
      let y = dPos[i3 + 1]! + dVel[i3 + 1]! * dt;
      const half = particleFloor.y + dSize[i3 + 1]! * 0.5 + 0.1;
      if (y < half) {
        y = half;
        dVel[i3 + 1] = Math.abs(dVel[i3 + 1]!) * 0.25;
        dVel[i3] = dVel[i3]! * 0.5;
        dVel[i3 + 2] = dVel[i3 + 2]! * 0.5;
        dSpin[i] = dSpin[i]! * 0.5;
      }
      dPos[i3] = x;
      dPos[i3 + 1] = y;
      dPos[i3 + 2] = z;
      dAngle[i] = dAngle[i]! + dSpin[i]! * dt;
      const fade = Math.min(1, (dLife[i]! - a) * 3);
      q.setFromAxisAngle(v2.set(dAxis[i3]!, dAxis[i3 + 1]!, dAxis[i3 + 2]!), dAngle[i]!);
      sc.set(dSize[i3]! * fade, dSize[i3 + 1]! * fade, dSize[i3 + 2]! * fade);
      debris.setMatrixAt(i, m4.compose(v1.set(x, y, z), q, sc));
      if (i % 2 === 0 && a < 1.1 && y > half + 1 && Math.random() < dt * 30) {
        sp.x = x;
        sp.y = y;
        sp.z = z;
        sp.vx = 0;
        sp.vy = 1;
        sp.vz = 0;
        sp.delay = 0;
        sp.life = 1.2 + Math.random() * 0.6;
        sp.size0 = 2.5;
        sp.size1 = 8;
        colors(0.2, 0.17, 0.15, 0.45, 0.44, 0.43);
        sp.alpha = 0.7;
        sp.drag = 1;
        sp.lift = 1;
        sp.fadeIn = 0.1;
        sp.spin = 0.5;
        smoke.spawn(sp);
        if (a < 0.7) {
          sp.life = 0.3;
          sp.size0 = 2.5;
          sp.size1 = 4;
          colors(1, 0.7, 0.3, 0.8, 0.25, 0.05);
          sp.alpha = 0.8;
          fire.spawn(sp);
        }
      }
    }
    debris.count = last + 1;
    debris.instanceMatrix.needsUpdate = true;
  };

  const updateShake = (dt: number, camera: PerspectiveCamera): void => {
    if (shakeApplied && camera.position.equals(appliedPos) && camera.quaternion.equals(appliedQuat)) {
      camera.position.copy(basePos);
      camera.quaternion.copy(baseQuat);
    }
    shakeApplied = false;
    if (shakeAmp < 0.002) {
      shakeAmp = 0;
      return;
    }
    basePos.copy(camera.position);
    baseQuat.copy(camera.quaternion);
    const a = shakeAmp, t = time;
    camera.position.x += (Math.sin(t * 37) + 0.6 * Math.sin(t * 59 + 1.7)) * a * 0.35;
    camera.position.y += (Math.sin(t * 43 + 0.5) + 0.6 * Math.sin(t * 71 + 2.3)) * a * 0.35;
    camera.position.z += (Math.sin(t * 31 + 2.1) + 0.6 * Math.sin(t * 67 + 0.9)) * a * 0.35;
    camera.rotateX((Math.sin(t * 47 + 0.3) + 0.5 * Math.sin(t * 83)) * a * 0.012);
    camera.rotateY((Math.sin(t * 41 + 1.1) + 0.5 * Math.sin(t * 79 + 0.4)) * a * 0.012);
    camera.rotateZ(Math.sin(t * 29 + 2.6) * a * 0.006);
    appliedPos.copy(camera.position);
    appliedQuat.copy(camera.quaternion);
    shakeApplied = true;
    shakeAmp *= Math.exp(-3.5 * dt);
  };

  return {
    setExhaust(vehicle, level) {
      const p = plumeFor(vehicle);
      p.level = Math.max(0, Math.min(1, level));
      if (p.group.parent !== vehicle.object) vehicle.object.add(p.group);
      p.group.visible = p.level > 0;
    },
    setPadSteam(level) {
      steam = Math.max(0, Math.min(1, level));
    },
    explode(at) {
      const ground = at.y < 15;
      const x = at.x, y = Math.max(at.y, 2), z = at.z;
      sp.x = x;
      sp.y = y;
      sp.z = z;
      sp.vx = sp.vy = sp.vz = 0;
      sp.delay = 0;
      sp.life = 0.35;
      sp.size0 = 70;
      sp.size1 = 140;
      colors(1, 0.97, 0.85, 1, 0.7, 0.35);
      sp.alpha = 1;
      sp.drag = 0;
      sp.lift = 0;
      sp.fadeIn = 0.02;
      sp.spin = 0;
      fire.spawn(sp);
      for (let i = 0; i < 140; i++) {
        const d = randomDir(ground), s = 12 + Math.random() * 30;
        sp.x = x + d.x * 3;
        sp.y = y + d.y * 3;
        sp.z = z + d.z * 3;
        sp.vx = d.x * s;
        sp.vy = d.y * s;
        sp.vz = d.z * s;
        sp.delay = Math.random() * 0.15;
        sp.life = 0.6 + Math.random() * 1.0;
        sp.size0 = 10 + Math.random() * 8;
        sp.size1 = 30 + Math.random() * 20;
        colors(1, 0.9, 0.55, 0.75, 0.18, 0.03);
        sp.alpha = 0.9;
        sp.drag = 2.2;
        sp.lift = 6;
        sp.fadeIn = 0.04;
        sp.spin = (Math.random() - 0.5) * 1.5;
        fire.spawn(sp);
      }
      for (let i = 0; i < 160; i++) {
        const d = randomDir(ground), s = 4 + Math.random() * 14;
        sp.x = x + d.x * 6;
        sp.y = y + d.y * 6;
        sp.z = z + d.z * 6;
        sp.vx = d.x * s;
        sp.vy = d.y * s + 4;
        sp.vz = d.z * s;
        sp.delay = 0.05 + Math.random() * 0.3;
        sp.life = 2.2 + Math.random() * 0.8;
        sp.size0 = 12 + Math.random() * 8;
        sp.size1 = 45 + Math.random() * 25;
        const g = Math.random() * 0.06;
        colors(0.15 + g, 0.12 + g, 0.1 + g, 0.4 + g, 0.38 + g, 0.37 + g);
        sp.alpha = 0.85;
        sp.drag = 1;
        sp.lift = 5;
        sp.fadeIn = 0.15;
        sp.spin = (Math.random() - 0.5) * 0.8;
        smoke.spawn(sp);
      }
      for (let n = 0; n < 30; n++) {
        const i = dNext;
        dNext = (dNext + 1) % DEBRIS;
        const i3 = i * 3;
        const d = randomDir(true), s = 15 + Math.random() * 35;
        dPos.set([x + d.x * 2, y + d.y * 2, z + d.z * 2], i3);
        dVel.set([d.x * s, d.y * s, d.z * s], i3);
        const ax = randomDir(false);
        dAxis.set([ax.x, ax.y, ax.z], i3);
        dSize.set([1.5 + Math.random() * 3.5, 0.2 + Math.random() * 0.3, 1 + Math.random() * 2.5], i3);
        dAge[i] = 0;
        dLife[i] = 2.6 + Math.random() * 0.6;
        dAngle[i] = Math.random() * 6;
        dSpin[i] = (Math.random() - 0.5) * 14;
      }
    },
    shake(strength) {
      shakeAmp = Math.min(1, shakeAmp + Math.max(0, strength));
    },
    setVapor(vehicle, level) {
      const v = vaporFor(vehicle);
      v.level = Math.max(0, Math.min(1, level));
      if (v.mesh.parent !== vehicle.object) vehicle.object.add(v.mesh);
      v.mesh.visible = v.level > 0;
    },
    setPlasma(vehicle, level, from) {
      const p = plasmaFor(vehicle);
      p.level = Math.max(0, Math.min(1, level));
      p.from.copy(from).normalize();
      if (p.sheath.parent !== vehicle.object) vehicle.object.add(p.sheath);
      if (!p.wake.parent) scene.add(p.wake);
      p.sheath.visible = p.wake.visible = p.level > 0;
    },
    update(dt, camera) {
      time += dt;
      for (let i = 0; i < plumeList.length; i++) updatePlume(plumeList[i]!, dt);
      for (let i = 0; i < vaporList.length; i++) updateVapor(vaporList[i]!, dt);
      for (let i = 0; i < plasmaList.length; i++) updatePlasma(plasmaList[i]!, dt, camera);
      emitSteam(dt);
      updateDebris(dt);
      smoke.update(dt);
      fire.update(dt);
      updateShake(dt, camera);
    },
    clear() {
      for (const p of plumeList) {
        p.level = 0;
        p.fireAcc = 0;
        p.smokeAcc = 0;
        p.group.removeFromParent();
      }
      for (const v of vaporList) {
        v.level = 0;
        v.acc = 0;
        v.mesh.removeFromParent();
      }
      for (const p of plasmaList) {
        p.level = 0;
        p.acc = 0;
        p.sheath.removeFromParent();
        p.wake.removeFromParent();
      }
      steam = 0;
      steamAcc = 0;
      smoke.clear();
      fire.clear();
      dLife.fill(0);
      debris.count = 0;
      shakeAmp = 0;
    },
    liveParticles() {
      return smoke.live() + fire.live();
    },
  };
}
