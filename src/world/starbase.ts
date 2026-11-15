import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Euler,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import type { Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tower } from '../types.ts';

/** Height of the launch mount's table top above the ground. */
export const MOUNT_TOP = 20;
/** Outer radius of the launch mount's table. */
export const MOUNT_RADIUS = 11;
/** Half the height of a booster catch pin; the pins rest on the arms' top faces. */
export const CATCH_PIN_HALF = 0.5;
/** How far above the mount a caught booster's base hangs. */
const CATCH_CLEARANCE = 6;
/** Direction towards the sun, unit length. */
export const SUN_DIR = new Vector3(0.4, 0.77, 0.5).normalize();
/** Sky colour at the horizon, also the fog colour (sRGB). */
const HORIZON = new Color(0.74, 0.86, 0.95);
const ZENITH = new Color(0.16, 0.42, 0.82);
const HAZE_GROUND = new Color(0.8, 0.74, 0.62);
const SEA_Y = -0.6;

const scratchQ = new Quaternion();
const scratchE = new Euler();
const scratchP = new Vector3();
const scratchS = new Vector3();
const scratchC = new Color();

/** A transform from a position, Euler rotation (radians) and scale. */
export function xf(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return new Matrix4().compose(scratchP.set(x, y, z), scratchQ.setFromEuler(scratchE.set(rx, ry, rz)), scratchS.set(sx, sy, sz));
}

/** Bakes a copy of `geometry`, transformed and painted one vertex colour, into a non-indexed position/normal/color part. */
export function part(geometry: BufferGeometry, color: number, matrix?: Matrix4): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (matrix) g.applyMatrix4(matrix);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  scratchC.set(color);
  for (let i = 0; i < n; i++) scratchC.toArray(colors, i * 3);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/** Merges parts from `part` into one geometry and disposes the parts. */
export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/** Reverses a non-indexed geometry's winding and normals so it faces inward. */
export function inward(geometry: BufferGeometry): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nor]) {
      const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, z);
    }
  }
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return g;
}

/** A canvas of the given size and its 2D context. */
export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Deterministic pseudo-random sequence in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sky's colour in direction (x, y, z), unit length, as sRGB 0..1 written into `out`. */
function skyColor(x: number, y: number, z: number, out: Color): Color {
  if (y >= 0) out.copy(HORIZON).lerp(ZENITH, 1 - Math.pow(1 - y, 2.6));
  else out.copy(HORIZON).lerp(HAZE_GROUND, Math.min(1, -y * 5));
  const c = Math.max(0, x * SUN_DIR.x + y * SUN_DIR.y + z * SUN_DIR.z);
  const sun = Math.pow(c, 1400) * 1.2 + Math.pow(c, 60) * 0.22 + Math.pow(c, 6) * 0.06;
  out.r = Math.min(1, out.r + sun);
  out.g = Math.min(1, out.g + sun * 0.96);
  out.b = Math.min(1, out.b + sun * 0.85);
  return out;
}

/** The equirectangular sky, `w` pixels wide, with its colours moved `desaturate` of the way to grey. */
function skyTexture(w: number, desaturate: number): CanvasTexture {
  const h = w / 2;
  const [c, ctx] = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  const col = new Color();
  const rand = rng(7);
  for (let py = 0; py < h; py++) {
    const lat = (0.5 - (py + 0.5) / h) * Math.PI;
    const cy = Math.sin(lat), cr = Math.cos(lat);
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w - 0.5) * Math.PI * 2;
      skyColor(Math.cos(lon) * cr, cy, Math.sin(lon) * cr, col);
      const grey = col.r * 0.3 + col.g * 0.55 + col.b * 0.15;
      col.r += (grey - col.r) * desaturate;
      col.g += (grey - col.g) * desaturate;
      col.b += (grey - col.b) * desaturate;
      const i = (py * w + px) * 4;
      const d = rand() - 0.5;
      img.data[i] = col.r * 255 + d;
      img.data[i + 1] = col.g * 255 + d;
      img.data[i + 2] = col.b * 255 + d;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A tiling noise texture for sand or concrete. */
function noiseTexture(size: number, base: [number, number, number], spread: number, seed: number): CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const rand = rng(seed);
  const blobs: [number, number, number, number][] = [];
  for (let i = 0; i < 40; i++) blobs.push([rand() * size, rand() * size, 8 + rand() * 40, (rand() - 0.5) * spread * 1.4]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = (rand() - 0.5) * spread;
      for (const [bx, by, br, bv] of blobs) {
        const dx = Math.min(Math.abs(x - bx), size - Math.abs(x - bx));
        const dy = Math.min(Math.abs(y - by), size - Math.abs(y - by));
        const d = (dx * dx + dy * dy) / (br * br);
        if (d < 1) v += bv * (1 - d);
      }
      const i = (y * size + x) * 4;
      img.data[i] = (base[0] + v) * 255;
      img.data[i + 1] = (base[1] + v) * 255;
      img.data[i + 2] = (base[2] + v * 0.9) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A tiling normal map of gentle crossing swells. */
function waveNormalTexture(): CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const k = (Math.PI * 2) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.cos(x * k * 3 + y * k * 1) * 0.35 + Math.cos(x * k * 7 - y * k * 4) * 0.2 + Math.cos(x * k * 13 + y * k * 9) * 0.1;
      const dy = Math.cos(y * k * 4 - x * k * 2) * 0.35 + Math.cos(y * k * 6 + x * k * 5) * 0.2 + Math.cos(y * k * 11 - x * k * 12) * 0.1;
      const i = (y * size + x) * 4;
      img.data[i] = (0.5 + dx * 0.5) * 255;
      img.data[i + 1] = (0.5 + dy * 0.5) * 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** The shoreline's z at a given x. */
function shoreZ(x: number): number {
  return -290 + 50 * Math.sin(x / 900) + 22 * Math.sin(x / 380 + 1.3);
}

/** A grid following the shoreline: columns at `xs`, rows at signed distances `ds` inland from the shore; land and sea meet at d = 0. */
function shoreGrid(xs: number[], ds: number[], y: (d: number) => number, color: (x: number, z: number, d: number, out: Color) => Color): BufferGeometry {
  const nx = xs.length, nd = ds.length;
  const pos = new Float32Array(nx * nd * 3);
  const col = new Float32Array(nx * nd * 3);
  const uv = new Float32Array(nx * nd * 2);
  const c = new Color();
  for (let j = 0; j < nd; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i] ?? 0, d = ds[j] ?? 0;
      const z = shoreZ(x) + d;
      const k = j * nx + i;
      pos.set([x, y(d), z], k * 3);
      color(x, z, d, c);
      c.convertSRGBToLinear();
      col.set([c.r, c.g, c.b], k * 3);
      uv.set([x / 120, z / 120], k * 2);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nd - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, dd = cc + 1;
      index.push(a, cc, b, b, cc, dd);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Low-frequency variation in [-1, 1] across the landscape. */
function lumps(x: number, z: number): number {
  return 0.5 * Math.sin(x * 0.0031 + z * 0.0023) + 0.3 * Math.sin(x * 0.0087 - z * 0.0061 + 2.1) + 0.2 * Math.sin(x * 0.021 + z * 0.017 + 4.0);
}

function columns(): number[] {
  const xs: number[] = [];
  for (let x = -15000; x <= 15000; x += x > -2000 && x < 2000 ? 50 : 500) xs.push(x);
  return xs;
}

function buildGround(): Mesh {
  const ds = [0, 6, 15, 40, 100, 250, 500, 1000, 2000, 4000, 8000, 15300];
  const y = (d: number): number => (d >= 15 ? 0 : SEA_Y + d * 0.04);
  const sand = new Color(0.9, 0.8, 0.62), wet = new Color(0.72, 0.63, 0.48), scrub = new Color(0.72, 0.7, 0.52);
  const rand = rng(11);
  const g = shoreGrid(columns(), ds, y, (x, z, d, out) => {
    if (d < 8) return out.copy(wet);
    out.copy(sand).lerp(scrub, Math.max(0, lumps(x, z)) * Math.min(1, (d - 30) / 200));
    out.multiplyScalar(0.95 + rand() * 0.07 + lumps(z, x) * 0.03);
    return out;
  });
  const mat = new MeshStandardMaterial({ map: noiseTexture(512, [0.98, 0.98, 0.98], 0.08, 3), vertexColors: true, roughness: 1, metalness: 0 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 2;
  const mesh = new Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildSea(): { mesh: Mesh; normals: CanvasTexture } {
  const ds = [-15300, -3000, -1000, -400, -150, -60, -25, -8, 0];
  const shallow = new Color(0.36, 0.75, 0.74), deep = new Color(0.07, 0.3, 0.5), foam = new Color(0.85, 0.92, 0.92);
  const g = shoreGrid(columns(), ds, () => SEA_Y, (_x, _z, d, out) => {
    if (d > -8) return out.copy(foam).lerp(shallow, Math.min(1, Math.max(0, -d / 8 + 0.2)));
    return out.copy(shallow).lerp(deep, Math.min(1, Math.pow((-d - 8) / 400, 0.6)));
  });
  const normals = waveNormalTexture();
  normals.repeat.set(1, 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.7, uv.getY(i) * 1.3);
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0, normalMap: normals, normalScale: new Vector2(0.22, 0.22) });
  const mesh = new Mesh(g, mat);
  mesh.receiveShadow = true;
  return { mesh, normals };
}

/** Concrete apron, roads, mount foundation and flame deflector, merged. */
function buildPadSurfaces(): Mesh {
  const box = new BoxGeometry(1, 1, 1);
  const concrete = 0xc9c6bf, asphalt = 0x4c4d50, darkConcrete = 0xa29f98, steel = 0x6d7176;
  const parts = [
    part(box, concrete, xf(-10, 0.15, 0, 0, 0, 0, 170, 0.3, 150)),
    part(box, darkConcrete, xf(-21, 0.5, 0, 0, 0, 0, 22, 1, 22)),
    part(new CylinderGeometry(12, 13, 0.8, 24), steel, xf(0, 0.6, 0)),
    part(box, asphalt, xf(1500, 0.12, 120, 0, 0, 0, 9000, 0.24, 11)),
    part(box, asphalt, xf(40, 0.14, 97, 0, 0, 0, 9, 0.28, 46)),
    part(box, asphalt, xf(110, 0.14, 30, 0, 0, 0, 9, 0.28, 180)),
    part(box, asphalt, xf(2000, 0.14, 200, 0, 0, 0, 9, 0.28, 160)),
    part(box, concrete, xf(2000, 0.13, 330, 0, 0, 0, 420, 0.26, 160)),
    part(box, concrete, xf(80, 0.13, -50, 0, 0, 0, 70, 0.26, 70)),
  ];
  const mesh = new Mesh(mergeParts(parts), new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, map: noiseTexture(256, [0.95, 0.95, 0.95], 0.06, 5) }));
  mesh.receiveShadow = true;
  return mesh;
}

/** The ring-shaped launch table on six legs with hold-down clamps. */
function buildMount(): Mesh {
  const box = new BoxGeometry(1, 1, 1);
  const grey = 0x8a8d91, dark = 0x55585d;
  const ring = new LatheGeometry([new Vector2(4.1, MOUNT_TOP - 3), new Vector2(MOUNT_RADIUS, MOUNT_TOP - 3), new Vector2(MOUNT_RADIUS, MOUNT_TOP), new Vector2(4.1, MOUNT_TOP), new Vector2(4.1, MOUNT_TOP - 3)], 36);
  const parts = [part(ring, grey)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    parts.push(part(box, grey, xf(Math.cos(a) * 9, (MOUNT_TOP - 3) / 2, Math.sin(a) * 9, 0, -a, 0, 2.6, MOUNT_TOP - 3, 2.6)));
    parts.push(part(box, dark, xf(Math.cos(a) * 9, MOUNT_TOP - 4.5, Math.sin(a) * 9, 0, -a + Math.PI / 2, 0, 9.4, 1.2, 1.2)));
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    parts.push(part(box, dark, xf(Math.cos(a) * 5.3, MOUNT_TOP + 0.7, Math.sin(a) * 5.3, 0, -a, 0, 1.2, 1.4, 0.9)));
  }
  const mesh = new Mesh(mergeParts(parts), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Tower geometry. Metres, world space. */
const TOWER_X = -21;
const TOWER_HALF = 5.5;
const TOWER_TOP = 142;
const COLUMN = 1.5;
/** How far the top platform and the carriage collar stand out past the lattice's centre lines. */
const OVERHANG = 1;
const SPINE_X = TOWER_X - TOWER_HALF - 1.5;
const SPINE_DEPTH = 2;
const MAST_X = TOWER_X + 3;
const MAST_HEIGHT = 12;
const MAST_BASE = TOWER_TOP + 2;
const ARM_PIVOT_X = -13.5;
const PIVOT_RADIUS = 1.1;
const CARRIAGE_SIDE = 1.7;
const ARM_HALF_WIDTH = 0.8;
/** Depth of an arm below its top face. */
const ARM_DEPTH = 3.4;
const ARM_LENGTH = 28;
const ARM_OPEN = (32 * Math.PI) / 180;

function buildTower(booster: { radius: number; catchPinHeight: number }): Tower {
  const object = new Group();
  object.name = 'tower';
  const latticeMat = new MeshStandardMaterial({ color: 0x464a50, roughness: 0.6, metalness: 0.55 });

  const up = new Vector3(0, 1, 0);
  const matrices: Matrix4[] = [];
  const member = (a: Vector3, b: Vector3, t: number): void => {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new Quaternion().setFromUnitVectors(up, dir.normalize());
    matrices.push(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(t, len, t)));
  };
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const corner = (i: number, y: number): Vector3 => {
    const c = corners[i % 4] ?? corners[0];
    return new Vector3(TOWER_X + c[0] * TOWER_HALF, y, c[1] * TOWER_HALF);
  };
  for (let i = 0; i < 4; i++) member(corner(i, 0), corner(i, TOWER_TOP), COLUMN);
  const bay = 7.1;
  for (let y = 0; y < TOWER_TOP - 0.1; y += bay) {
    const y1 = Math.min(TOWER_TOP, y + bay);
    for (let i = 0; i < 4; i++) {
      member(corner(i, y1), corner(i + 1, y1), 0.9);
      member(corner(i, y), corner(i + 1, y1), 0.55);
      member(corner(i + 1, y), corner(i, y1), 0.55);
    }
  }
  const lattice = new InstancedMesh(new BoxGeometry(1, 1, 1), latticeMat, matrices.length);
  matrices.forEach((m, i) => lattice.setMatrixAt(i, m));
  lattice.castShadow = true;
  lattice.receiveShadow = true;
  object.add(lattice);

  const box = new BoxGeometry(1, 1, 1);
  const core = 0x5d6269, dark = 0x3a3d42, light = 0x9a9ea4;
  const statics = [
    part(box, core, xf(TOWER_X, TOWER_TOP / 2, 0, 0, 0, 0, 7, TOWER_TOP, 7)),
    part(box, dark, xf(TOWER_X, TOWER_TOP + 1, 0, 0, 0, 0, 2 * (TOWER_HALF + OVERHANG), 2, 2 * (TOWER_HALF + OVERHANG))),
    part(box, dark, xf(TOWER_X - 2, TOWER_TOP + 4, 2, 0, 0, 0, 5, 4, 5)),
    part(new CylinderGeometry(0.3, 0.5, MAST_HEIGHT, 6), light, xf(MAST_X, MAST_BASE + MAST_HEIGHT / 2, -3)),
    part(box, dark, xf(SPINE_X, TOWER_TOP / 2, 0, 0, 0, 0, SPINE_DEPTH, TOWER_TOP, 3)),
  ];
  const staticMesh = new Mesh(mergeParts(statics), new MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.5 }));
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  object.add(staticMesh);

  const catchPoint = new Vector3(0, MOUNT_TOP + CATCH_CLEARANCE + booster.catchPinHeight, 0);
  const pivotZ = booster.radius + ARM_HALF_WIDTH;
  const armTop = catchPoint.y - CATCH_PIN_HALF;

  const carriage = new Group();
  carriage.position.y = armTop;
  object.add(carriage);
  const armMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.55 });
  const carriageMesh = new Mesh(
    mergeParts([
      part(box, dark, xf(ARM_PIVOT_X - 0.5, -1.5, 0, 0, 0, 0, 3, 8, 2 * (pivotZ + CARRIAGE_SIDE))),
      part(box, core, xf(TOWER_X, -1.5, 0, 0, 0, 0, 2 * (TOWER_HALF + OVERHANG), 2.4, 2 * (TOWER_HALF + OVERHANG))),
      part(new CylinderGeometry(PIVOT_RADIUS, PIVOT_RADIUS, 5, 10), light, xf(ARM_PIVOT_X, -1.5, pivotZ)),
      part(new CylinderGeometry(PIVOT_RADIUS, PIVOT_RADIUS, 5, 10), light, xf(ARM_PIVOT_X, -1.5, -pivotZ)),
    ]),
    armMat,
  );
  carriageMesh.castShadow = true;
  carriage.add(carriageMesh);

  const armGeo = mergeParts([
    part(box, 0x3a3e44, xf(ARM_LENGTH / 2, -(ARM_DEPTH - 0.2) / 2, 0, 0, 0, 0, ARM_LENGTH, ARM_DEPTH - 0.8, ARM_HALF_WIDTH * 2)),
    part(box, light, xf(ARM_LENGTH / 2 + 1, -0.15, 0, 0, 0, 0, ARM_LENGTH - 2, 0.3, ARM_HALF_WIDTH * 2)),
    part(box, 0x23262a, xf(ARM_LENGTH - 0.4, -(ARM_DEPTH + 0.2) / 2, 0, 0, 0, 0, 0.8, ARM_DEPTH - 0.2, ARM_HALF_WIDTH * 2)),
  ]);
  const pivots = [1, -1].map((side) => {
    const pivot = new Group();
    pivot.position.set(ARM_PIVOT_X, 0, side * pivotZ);
    const arm = new Mesh(armGeo, armMat);
    arm.castShadow = true;
    pivot.add(arm);
    carriage.add(pivot);
    return { pivot, side };
  });

  const d = -ARM_PIVOT_X;
  const catchHalfWidth = pivotZ + d * Math.tan(ARM_OPEN) - ARM_HALF_WIDTH / Math.cos(ARM_OPEN);

  const setChopsticks = (closed: number): void => {
    const a = ARM_OPEN * (1 - Math.min(1, Math.max(0, closed)));
    for (const { pivot, side } of pivots) pivot.rotation.y = -side * a;
  };
  setChopsticks(0);
  const arms = { pivotX: ARM_PIVOT_X, length: ARM_LENGTH, openSlope: Math.tan(ARM_OPEN), halfWidth: ARM_HALF_WIDTH, halfHeight: ARM_DEPTH + CATCH_PIN_HALF };
  const towerHalf = Math.max(TOWER_HALF + COLUMN / 2, TOWER_HALF + OVERHANG);
  const footprint = {
    minX: Math.min(SPINE_X - SPINE_DEPTH / 2, TOWER_X - towerHalf),
    maxX: Math.max(TOWER_X + towerHalf, ARM_PIVOT_X + PIVOT_RADIUS),
    halfZ: Math.max(towerHalf, pivotZ + CARRIAGE_SIDE),
    top: MAST_BASE + MAST_HEIGHT,
  };
  return { object, catchPoint, catchHalfWidth, arms, footprint, setChopsticks };
}

/** Tank farm, buildings and scrub, as instanced meshes. */
function buildScenery(): Group {
  const group = new Group();
  const rand = rng(23);

  const tankProfile: Vector2[] = [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1)];
  for (let i = 1; i <= 5; i++) tankProfile.push(new Vector2(Math.cos((i / 5) * Math.PI * 0.5), 1 + Math.sin((i / 5) * Math.PI * 0.5) * 0.12));
  const tanks: [number, number, number, number][] = [
    [58, -32, 4.5, 26],
    [70, -32, 4.5, 26],
    [82, -32, 4.5, 26],
    [58, -46, 4.5, 26],
    [70, -46, 4.5, 26],
    [82, -46, 4.5, 26],
    [64, -62, 6, 18],
    [79, -62, 6, 18],
    [96, -38, 3, 14],
    [96, -48, 3, 14],
  ];
  const tankMesh = new InstancedMesh(new LatheGeometry(tankProfile, 20), new MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.45, metalness: 0.1 }), tanks.length);
  tanks.forEach(([x, z, r, h], i) => tankMesh.setMatrixAt(i, xf(x, 0, z, 0, 0, 0, r, h, r)));
  tankMesh.castShadow = true;
  tankMesh.receiveShadow = true;
  group.add(tankMesh);

  const buildings: [number, number, number, number, number, number][] = [
    [120, 45, 26, 8, 14, 0xe6e6e2],
    [150, 70, 18, 6, 12, 0xb9c3cc],
    [125, -20, 14, 5, 22, 0xd9d6cf],
    [30, 60, 12, 4, 8, 0xe6e6e2],
    [-60, 55, 20, 7, 12, 0x9aa5ae],
    [-75, -40, 16, 9, 16, 0xd9d6cf],
    [260, 150, 40, 10, 22, 0xe6e6e2],
    [330, 155, 22, 7, 14, 0xb9c3cc],
    [1900, 330, 70, 55, 90, 0xeeeeea],
    [2010, 330, 60, 45, 80, 0xeeeeea],
    [2110, 320, 46, 30, 60, 0xc9d1d8],
    [1960, 410, 90, 18, 40, 0xd5d2cb],
    [2200, 280, 30, 14, 30, 0xb9c3cc],
    [1800, 280, 20, 10, 20, 0xe6e6e2],
  ];
  const bMesh = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }), buildings.length);
  buildings.forEach(([x, z, w, h, dp, c], i) => {
    bMesh.setMatrixAt(i, xf(x, 0, z, 0, 0, 0, w, h, dp));
    bMesh.setColorAt(i, scratchC.set(c));
  });
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  group.add(bMesh);

  const scrubCount = 420;
  const scrub = new InstancedMesh(new CylinderGeometry(1, 1.15, 1, 7).translate(0, 0.5, 0), new MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }), scrubCount);
  const green = new Color(0x7d8a4a), brown = new Color(0xa39466);
  let n = 0;
  while (n < scrubCount) {
    const x = (rand() - 0.5) * 6000, z = -300 + rand() * 4000;
    if (z - shoreZ(x) < 60 || (Math.abs(x) < 130 && Math.abs(z) < 110) || Math.abs(z - 120) < 15 || (x > 1700 && x < 2300 && z > 230 && z < 450)) continue;
    const s = 4 + rand() * 18;
    scrub.setMatrixAt(n, xf(x, 0, z, 0, rand() * 3, 0, s, 0.6 + rand() * 1.2, s * (0.6 + rand() * 0.6)));
    scrub.setColorAt(n, scratchC.copy(green).lerp(brown, rand()));
    n++;
  }
  scrub.receiveShadow = true;
  group.add(scrub);
  return group;
}

interface Clouds {
  mesh: InstancedMesh;
  update(dt: number): void;
}

function buildClouds(): Clouds {
  const rand = rng(41);
  const puffs: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.55 + rand() * 0.35;
    const s = i === 0 ? 0.75 : 0.35 + rand() * 0.3;
    puffs.push(part(new IcosahedronGeometry(1, 1), 0xffffff, xf(Math.cos(a) * r, s * 0.25, Math.sin(a) * r * 0.6, 0, rand() * 3, 0, s, s * 0.75, s)));
  }
  const geo = mergeParts(puffs);
  const count = 16;
  const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ color: 0xffffff, emissive: 0xb8c4d4, emissiveIntensity: 0.35, roughness: 1, metalness: 0, flatShading: true }), count);
  const state: [number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, d = 2500 + rand() * 7000;
    state.push([Math.cos(a) * d, 1500 + rand() * 1100, Math.sin(a) * d, 260 + rand() * 300]);
  }
  const m = new Matrix4();
  const place = (): void => {
    for (let i = 0; i < count; i++) {
      const c = state[i]!;
      m.compose(scratchP.set(c[0], c[1], c[2]), scratchQ.setFromEuler(scratchE.set(0, i, 0)), scratchS.set(c[3], c[3] * 0.55, c[3] * 0.8));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place();
  mesh.frustumCulled = false;
  return {
    mesh,
    update(dt) {
      for (let i = 0; i < count; i++) {
        const c = state[i]!;
        c[0] += dt * 6;
        if (c[0] > 10000) c[0] -= 20000;
      }
      place();
    },
  };
}

/** The site without the rocket: sky, light, ground, sea, mount, tower and scenery. */
export interface Starbase {
  readonly root: Group;
  readonly tower: Tower;
  readonly padPoint: Vector3;
  update(dt: number): void;
}

/** Builds the site into a new group, and sets the scene's background, environment and fog and adds the sun. */
export function createStarbase(scene: Scene, booster: { radius: number; catchPinHeight: number }): Starbase {
  scene.background = skyTexture(1024, 0);
  scene.environment = skyTexture(256, 0.6);
  scene.fog = new Fog(HORIZON.clone().convertSRGBToLinear(), 900, 15000);

  const root = new Group();
  root.name = 'starbase';
  const sun = new DirectionalLight(0xfff4e2, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(600);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -170;
  cam.right = 170;
  cam.top = 190;
  cam.bottom = -150;
  cam.near = 300;
  cam.far = 1000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  root.add(sun, sun.target);

  const { mesh: sea, normals } = buildSea();
  const tower = buildTower(booster);
  const clouds = buildClouds();
  root.add(buildGround(), sea, buildPadSurfaces(), buildMount(), tower.object, buildScenery(), clouds.mesh);

  return {
    root,
    tower,
    padPoint: new Vector3(0, MOUNT_TOP, 0),
    update(dt) {
      normals.offset.x += dt * 0.006;
      normals.offset.y += dt * 0.0035;
      clouds.update(dt);
    },
  };
}
