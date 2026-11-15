import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  EquirectangularReflectionMapping,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import type { Vector3 } from 'three';
import { canvas2d, rng } from './starbase.ts';

/** Radius of the Earth in scene units. */
const EARTH_R = 6371;
/** Height of the orbit above the Earth's surface in scene units; the surface's top is this far below the origin. */
export const ORBIT_ALTITUDE = 400;
/** Scene units per repeat of the surface and cloud textures. */
const TILE = 1800;
/** How fast the surface slides towards +Z, scene units per second. */
const GROUND_SPEED = 45;
const CLOUD_SPEED = 52;

/** Tileable value-noise fBm over a `period`-cell lattice, in [0, 1]. */
function fbm(seed: number, period: number, octaves: number): (x: number, y: number) => number {
  const layers: Float32Array[] = [];
  const rand = rng(seed);
  for (let o = 0; o < octaves; o++) {
    const p = period << o;
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    layers.push(g);
  }
  return (x, y) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = period << o;
      const g = layers[o]!;
      const fx = x * p, fy = y * p;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const x0 = ((ix % p) + p) % p, y0 = ((iy % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
      const a = g[y0 * p + x0]!, b = g[y0 * p + x1]!, c = g[y1 * p + x0]!, d = g[y1 * p + x1]!;
      sum += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

function tiled(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Oceans and continents seen from orbit. */
function surfaceTexture(): CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const height = fbm(31, 4, 6), moist = fbm(32, 3, 4);
  const deep = new Color(0.03, 0.14, 0.36), shallow = new Color(0.08, 0.36, 0.55), sand = new Color(0.66, 0.6, 0.44);
  const forest = new Color(0.17, 0.33, 0.13), desert = new Color(0.62, 0.48, 0.3), col = new Color(), ocean = new Color(), land = new Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = height(x / size, y / size), m = moist(x / size, y / size);
      const coast = Math.min(1, Math.max(0, (h - 0.512) / 0.016));
      ocean.copy(deep).lerp(shallow, Math.pow(Math.min(1, Math.max(0, (h - 0.38) / 0.14)), 2));
      land.copy(forest).lerp(desert, Math.min(1, Math.max(0, (0.55 - m) * 5))).multiplyScalar(0.9 + Math.max(0, h - 0.53) * 0.8);
      land.lerp(sand, Math.max(0, 1 - Math.max(0, h - 0.52) / 0.02) * 0.6);
      col.copy(ocean).lerp(land, coast * coast * (3 - 2 * coast));
      const i = (y * size + x) * 4;
      img.data[i] = col.r * 255;
      img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tiled(c);
}

/** White cloud bands in the alpha channel. */
function cloudTexture(): CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const n = fbm(33, 4, 6), band = fbm(34, 2, 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = n(x / size, y / size) * 0.75 + band(x / size, y / size) * 0.4 - 0.08;
      const a = Math.min(1, Math.max(0, (v - 0.5) / 0.18));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * a * (3 - 2 * a) * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tiled(c);
}

/** A cap of a sphere centred below the origin, with planar texture coordinates of `TILE` units per repeat. */
function cap(radius: number): BufferGeometry {
  const g = new SphereGeometry(radius, 192, 48, 0, Math.PI * 2, 0, 0.44).translate(0, -(EARTH_R + ORBIT_ALTITUDE), 0);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / TILE, pos.getZ(i) / TILE);
  return g;
}

const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const ATMOSPHERE_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float g = pow(rim, 5.0) * 1.6 + pow(rim, 2.0) * 0.08;
  gl_FragColor = vec4(vec3(0.38, 0.64, 1.0) * g, 1.0);
}`;

/** A star field of `count` points on a sphere of radius `radius` around the origin. */
export function starField(count: number, radius: number, seed: number): BufferGeometry {
  const rand = rng(seed);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([Math.cos(a) * r * radius, z * radius, Math.sin(a) * r * radius], i * 3);
    const b = 0.35 + Math.pow(rand(), 3) * 0.65;
    col.set([b, b, b * (0.9 + rand() * 0.2)], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** The orbit environment map: black space above, the bright Earth below the horizon, the sun. */
function orbitEnvironment(sun: Vector3): CanvasTexture {
  const w = 256, h = 128;
  const [c, ctx] = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  const dip = -Math.sqrt(1 - Math.pow(EARTH_R / (EARTH_R + ORBIT_ALTITUDE), 2));
  const zenith = new Color(0.26, 0.28, 0.33), space = new Color(0.42, 0.47, 0.55), earth = new Color(0.5, 0.62, 0.78), glow = new Color(0.6, 0.78, 1), col = new Color();
  for (let py = 0; py < h; py++) {
    const lat = (0.5 - (py + 0.5) / h) * Math.PI;
    const y = Math.sin(lat), cr = Math.cos(lat);
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w - 0.5) * Math.PI * 2;
      const x = Math.cos(lon) * cr, z = Math.sin(lon) * cr;
      if (y < dip) col.copy(earth).lerp(glow, Math.max(0, 1 - (dip - y) * 8));
      else col.copy(space).lerp(zenith, Math.min(1, (y - dip) * 1.6)).lerp(glow, Math.max(0, 1 - (y - dip) * 20));
      const s = Math.max(0, x * sun.x + y * sun.y + z * sun.z);
      const k = Math.pow(s, 600) * 4 + Math.pow(s, 30) * 0.2 + Math.pow(s, 6) * 0.3;
      const i = (py * w + px) * 4;
      img.data[i] = Math.min(255, (col.r + k) * 255);
      img.data[i + 1] = Math.min(255, (col.g + k) * 255);
      img.data[i + 2] = Math.min(255, (col.b + k * 0.95) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The Earth from low orbit with its clouds, atmosphere glow and stars. */
export interface Orbit {
  readonly group: Group;
  /** Environment map for the vehicles' reflections in orbit. */
  readonly environment: CanvasTexture;
  /** Slides the surface and the clouds towards +Z. */
  update(dt: number): void;
}

/** Builds the orbit scene, hidden until shown; `sun` is the unit direction towards the sun. */
export function createOrbit(sun: Vector3): Orbit {
  const group = new Group();
  group.name = 'orbit';
  group.visible = false;
  const surfaceMap = surfaceTexture();
  const cloudMap = cloudTexture();
  const surface = new Mesh(cap(EARTH_R), new MeshBasicMaterial({ map: surfaceMap, fog: false }));
  const clouds = new Mesh(cap(EARTH_R + 6), new MeshBasicMaterial({ map: cloudMap, transparent: true, depthWrite: false, fog: false }));
  const atmosphere = new Mesh(
    cap(EARTH_R + 70),
    new ShaderMaterial({ vertexShader: ATMOSPHERE_VERT, fragmentShader: ATMOSPHERE_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
  );
  surface.renderOrder = -2;
  clouds.renderOrder = -1;
  const stars = new Points(starField(2500, 20000, 51), new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false }));
  group.add(stars, surface, clouds, atmosphere);
  return {
    group,
    environment: orbitEnvironment(sun),
    update(dt) {
      surfaceMap.offset.y -= (dt * GROUND_SPEED) / TILE;
      cloudMap.offset.y -= (dt * CLOUD_SPEED) / TILE;
    },
  };
}
