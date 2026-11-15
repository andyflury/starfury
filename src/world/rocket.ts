import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  SRGBColorSpace,
  Vector2,
} from 'three';
import type { Booster, Vehicle } from '../types.ts';
import { CATCH_PIN_HALF, canvas2d, inward, mergeParts, part, rng, xf } from './starbase.ts';

const R = 4.5;
const BOOSTER_H = 71;
const RING_BOTTOM = 68.5;
const PIN_H = 61;
const SHIP_H = 50;
const BARREL_H = 33;
const STEEL = 0xc2c6cb;
const DARK = 0x3c3f44;

/** Painters for a hull's colour and roughness/metalness canvases in metres: x around the hull from -Z through -X, +Z and +X back to -Z, y up from the base. */
interface HullPainter {
  (color: CanvasRenderingContext2D, orm: CanvasRenderingContext2D, circ: number, height: number): void;
}

/** Brushed stainless steel with weld rings, then `paint`; returns colour map and roughness/metalness map. */
function hullTextures(w: number, h: number, height: number, seed: number, paint: HullPainter): { map: CanvasTexture; orm: CanvasTexture } {
  const circ = Math.PI * 2 * R;
  const [cc, color] = canvas2d(w, h);
  const [oc, orm] = canvas2d(w / 2, h / 2);
  color.setTransform(w / circ, 0, 0, -h / height, 0, h);
  orm.setTransform(w / 2 / circ, 0, 0, -h / 2 / height, 0, h / 2);
  const rand = rng(seed);
  color.fillStyle = '#c6cacf';
  color.fillRect(0, 0, circ, height);
  orm.fillStyle = 'rgb(255,78,255)';
  orm.fillRect(0, 0, circ, height);
  for (let i = 0; i < 900; i++) {
    const x = rand() * circ, wd = 0.02 + rand() * 0.06;
    color.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${0.02 + rand() * 0.04})` : `rgba(60,64,70,${0.02 + rand() * 0.04})`;
    color.fillRect(x, 0, wd, height);
    orm.fillStyle = `rgb(255,${66 + Math.floor(rand() * 30)},255)`;
    orm.fillRect(x, 0, wd * 2, height);
  }
  for (let y = 1.83; y < height; y += 1.83) {
    color.fillStyle = 'rgba(80,84,90,0.18)';
    color.fillRect(0, y, circ, 0.06);
  }
  paint(color, orm, circ, height);
  const map = new CanvasTexture(cc);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const ormTex = new CanvasTexture(oc);
  ormTex.anisotropy = 8;
  return { map, orm: ormTex };
}

/** A hull material from `hullTextures`. */
function hullMaterial(t: { map: CanvasTexture; orm: CanvasTexture }): MeshStandardMaterial {
  return new MeshStandardMaterial({ map: t.map, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1 });
}

/** Sets every vertex's v texture coordinate to its height over `height`. */
function heightUv(g: BufferGeometry, height: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / height);
  return g;
}

/** An open barrel of radius R from y0 to y1, texture u = 0.5 facing +Z. */
function barrel(y0: number, y1: number, segments: number): BufferGeometry {
  return new CylinderGeometry(R, R, y1 - y0, segments, 1, true, Math.PI, Math.PI * 2).translate(0, (y0 + y1) / 2, 0);
}

/** A disk of radius `r` at height y, facing up (`up`) or down. */
function disk(r: number, y: number, up: boolean): BufferGeometry {
  return new CircleGeometry(r, 32).rotateX(up ? -Math.PI / 2 : Math.PI / 2).translate(0, y, 0);
}

/** Engine bell: exit radius 1 at y = 0, throat at y = 1. */
function bellGeometry(scale: number): LatheGeometry {
  const pts = [new Vector2(0.42, 1), new Vector2(0.5, 0.8), new Vector2(0.72, 0.42), new Vector2(1, 0)].map((p) => p.multiplyScalar(scale));
  return new LatheGeometry(pts, 14);
}

const bellMaterial = new MeshStandardMaterial({ color: 0x3b3b40, roughness: 0.35, metalness: 0.85, side: DoubleSide });
const glowMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false });

/** A disk's worth of glow colours: orange inside the bell, white-yellow across the exit. */
function glowGeometry(): BufferGeometry {
  return mergeParts([part(bellGeometry(0.94), 0xff5a10, xf(0, 0.01, 0)), part(new CircleGeometry(0.93, 14), 0xffc860, xf(0, 0.02, 0, Math.PI / 2))]);
}

/** Engine bells and their glow as two instanced meshes; `engines` lists [x, z, exit radius, length] centre outward. */
function engineCluster(engines: [number, number, number, number][], baseY: number): { group: Group; setLit(count: number): void } {
  const bells = new InstancedMesh(bellGeometry(1), bellMaterial, engines.length);
  const glow = new InstancedMesh(glowGeometry(), glowMaterial, engines.length);
  engines.forEach(([x, z, r, l], i) => {
    const m = xf(x, baseY, z, 0, 0, 0, r, l, r);
    bells.setMatrixAt(i, m);
    glow.setMatrixAt(i, m);
  });
  glow.count = 0;
  bells.frustumCulled = false;
  glow.frustumCulled = false;
  const group = new Group();
  group.add(bells, glow);
  return {
    group,
    setLit(count) {
      glow.count = Math.max(0, Math.min(engines.length, Math.round(count)));
    },
  };
}

function ring(n: number, radius: number, start: number, exitR: number, length: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * radius, Math.sin(a) * radius, exitR, length]);
  }
  return out;
}

/** A grid fin in its own frame: x radial outward from the hull, y up, z thickness. */
function gridFinParts(): BufferGeometry[] {
  const box = new BoxGeometry(1, 1, 1);
  const x0 = R + 0.3, x1 = R + 3.6, h = 4.2, t = 0.45;
  const parts: BufferGeometry[] = [
    part(box, DARK, xf((x0 + x1) / 2, h / 2, 0, 0, 0, 0, x1 - x0, 0.3, t)),
    part(box, DARK, xf((x0 + x1) / 2, -h / 2, 0, 0, 0, 0, x1 - x0, 0.3, t)),
    part(box, DARK, xf(x0, 0, 0, 0, 0, 0, 0.3, h, t)),
    part(box, DARK, xf(x1, 0, 0, 0, 0, 0, 0.3, h, t)),
    part(box, 0x55585e, xf(R - 0.1, 0, 0, 0, 0, 0, 1.0, 1.6, 1.4)),
  ];
  for (let i = 1; i < 5; i++) parts.push(part(box, DARK, xf(x0 + ((x1 - x0) * i) / 5, 0, 0, 0, 0, 0, 0.12, h, t)));
  for (let i = 1; i < 5; i++) parts.push(part(box, DARK, xf((x0 + x1) / 2, -h / 2 + (h * i) / 5, 0, 0, 0, 0, x1 - x0, 0.12, t)));
  return parts;
}

/** Super Heavy. Grid fins on the diagonals, catch pins facing ±Z, chines on ±X. */
export function createBooster(): Booster {
  const object = new Group();
  object.name = 'booster';
  const tex = hullTextures(512, 1024, BOOSTER_H, 5, (color, orm, circ) => {
    const soot = color.createLinearGradient(0, 0, 0, 7);
    soot.addColorStop(0, 'rgba(40,34,30,0.55)');
    soot.addColorStop(1, 'rgba(40,34,30,0)');
    color.fillStyle = soot;
    color.fillRect(0, 0, circ, 7);
    color.fillStyle = '#4a4d52';
    color.fillRect(0, RING_BOTTOM, circ, BOOSTER_H - RING_BOTTOM);
    orm.fillStyle = 'rgb(255,150,110)';
    orm.fillRect(0, RING_BOTTOM, circ, BOOSTER_H - RING_BOTTOM);
    for (let i = 0; i < 40; i++) {
      const x = (i / 40) * circ + 0.18;
      color.fillStyle = '#0c0c0e';
      color.fillRect(x, RING_BOTTOM + 0.35, 0.36, BOOSTER_H - RING_BOTTOM - 0.7);
      orm.fillStyle = 'rgb(255,240,0)';
      orm.fillRect(x, RING_BOTTOM + 0.35, 0.36, BOOSTER_H - RING_BOTTOM - 0.7);
    }
  });
  const hull = new Mesh(heightUv(barrel(0, BOOSTER_H, 40), BOOSTER_H), hullMaterial(tex));
  hull.castShadow = true;
  hull.receiveShadow = true;

  const box = new BoxGeometry(1, 1, 1);
  const parts: BufferGeometry[] = [
    part(disk(R, BOOSTER_H, true), 0x8d9197),
    part(disk(R - 0.05, 1.8, false), 0x2a2b2e),
    part(inward(barrel(0, 1.8, 32).scale(0.985, 1, 0.985)), 0x2f3033),
  ];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    for (const p of gridFinParts()) {
      p.applyMatrix4(xf(0, 66.4, 0, 0, -a, 0));
      parts.push(p);
    }
  }
  for (const side of [1, -1]) {
    parts.push(part(box, STEEL, xf(0, PIN_H, side * (R + 0.6), 0, 0, 0, 1.2, CATCH_PIN_HALF * 2, 1.6)));
    parts.push(part(box, 0x9ca0a6, xf(0, PIN_H + 1.1, side * (R + 0.2), 0, 0, 0, 2.2, 1.6, 0.6)));
  }
  for (const a of [0, Math.PI]) {
    parts.push(part(box, STEEL, xf(Math.cos(a) * (R + 0.1), 13, Math.sin(a) * (R + 0.1), 0, -a, 0, 0.6, 22, 0.45)));
  }
  const details = new Mesh(mergeParts(parts), new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.8 }));
  details.castShadow = true;

  const engines = [...ring(3, 0.78, Math.PI / 2, 0.6, 1.55), ...ring(10, 2.3, 0, 0.6, 1.55), ...ring(20, 3.78, Math.PI / 20, 0.56, 1.5)];
  const cluster = engineCluster(engines, 0.08);
  object.add(hull, details, cluster.group);
  return { object, height: BOOSTER_H, radius: R, engineCount: engines.length, catchPinHeight: PIN_H, setEnginesLit: cluster.setLit };
}

/** The nose radius at fraction t of the way from the barrel top to the tip. */
function noseR(t: number): number {
  return R * Math.pow(Math.cos((Math.min(1, t) * Math.PI) / 2), 0.62);
}

/** Paints the black heat-shield tiles over the -Z half. */
function paintTiles(color: CanvasRenderingContext2D, orm: CanvasRenderingContext2D, circ: number, height: number): void {
  for (const [x0, x1] of [
    [0, circ * 0.25],
    [circ * 0.75, circ],
  ] as const) {
    color.fillStyle = '#1c1d20';
    color.fillRect(x0, 0, x1 - x0, height);
    orm.fillStyle = 'rgb(255,215,0)';
    orm.fillRect(x0, 0, x1 - x0, height);
    color.save();
    color.beginPath();
    color.rect(x0, 0, x1 - x0, height);
    color.clip();
    color.strokeStyle = '#34353a';
    color.lineWidth = 0.05;
    const s = 0.5, dx = s * Math.sqrt(3), dy = s * 1.5;
    for (let row = 0, y = 0; y < height + s; row++, y += dy) {
      for (let x = x0 - dx + (row % 2) * (dx / 2); x < x1 + dx; x += dx) {
        color.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          color.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
        }
        color.closePath();
        color.stroke();
      }
    }
    color.restore();
  }
}

/** Paints the StarFury wordmark, reading bottom to top, centred on the +Z side. */
function paintWordmark(color: CanvasRenderingContext2D, circ: number): void {
  const length = 22, centreY = 18.5;
  color.save();
  color.translate(circ / 2, centreY);
  color.rotate(Math.PI / 2);
  color.scale(0.01, -0.01);
  color.font = 'italic 900 400px "Arial Black", "Segoe UI Black", Impact, "Helvetica Neue", Arial, sans-serif';
  color.textAlign = 'center';
  color.textBaseline = 'alphabetic';
  const text = 'STARFURY';
  const w = color.measureText(text).width;
  const k = (length * 100) / w;
  color.save();
  color.scale(k, 1);
  color.fillStyle = '#121316';
  color.fillText(text, 0, 50);
  color.restore();
  const half = (length * 100) / 2;
  color.beginPath();
  color.moveTo(-half, 115);
  color.quadraticCurveTo(0, 170, half * 0.86, 105);
  color.lineTo(half * 0.86, 145);
  color.quadraticCurveTo(0, 215, -half, 115);
  color.closePath();
  color.fillStyle = '#c1121f';
  color.fill();
  const sx = half * 0.95, sy = 118, so = 80, si = 20;
  color.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 === 0 ? so : si;
    color.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
  }
  color.closePath();
  color.fill();
  color.restore();
}

/** A flap plate in the XY plane (x radial, thickness along z) turned by `ry` about Y, black on its -Z face and steel elsewhere. */
function flap(root: [number, number][], tip: [number, number][], ry: number): BufferGeometry {
  const shape = new Shape();
  const pts = [...root, ...tip.slice().reverse()];
  const first = pts[0] ?? [0, 0];
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const g = part(new ExtrudeGeometry(shape, { depth: 0.36, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.18), 0x9a9ea4, xf(0, 0, 0, 0, ry, 0));
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  for (let i = 0; i < nor.count; i++) if (nor.getZ(i) < -0.5) col.setXYZ(i, 0.011, 0.012, 0.014);
  return g;
}

/** StarFury, the ship. Heat-shield tiles on -Z, the wordmark on +Z, flaps on ±X. */
export function createShip(): Vehicle {
  const object = new Group();
  object.name = 'ship';
  const tex = hullTextures(1024, 2048, SHIP_H, 9, (color, orm, circ, height) => {
    paintTiles(color, orm, circ, height);
    paintWordmark(color, circ);
  });
  const nosePts: Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    nosePts.push(new Vector2(Math.max(0.001, noseR(t)), BARREL_H + t * (SHIP_H - BARREL_H)));
  }
  const nose = new LatheGeometry(nosePts, 40, Math.PI);
  const hullGeo = mergeParts([heightUv(barrel(0, BARREL_H, 40), SHIP_H), heightUv(nose, SHIP_H)].map((g) => g.toNonIndexed()));
  const hull = new Mesh(hullGeo, hullMaterial(tex));
  hull.castShadow = true;
  hull.receiveShadow = true;

  const fwdRoot: [number, number][] = [];
  for (let y = 35.5; y <= 43.6; y += 2.7) fwdRoot.push([noseR((y - BARREL_H) / (SHIP_H - BARREL_H)) - 0.15, y]);
  const fwdTip: [number, number][] = [
    [noseR(5 / 17) + 1.9, 37.2],
    [noseR(9 / 17) + 1.7, 42.0],
  ];
  const aftRoot: [number, number][] = [
    [R - 0.1, 0.8],
    [R - 0.1, 11.5],
  ];
  const aftTip: [number, number][] = [
    [R + 2.9, 2.2],
    [R + 2.9, 9.3],
  ];
  const parts: BufferGeometry[] = [part(disk(R - 0.05, 2.75, false), 0x2a2b2e), part(inward(barrel(0, 2.75, 32).scale(0.985, 1, 0.985)), 0x2f3033)];
  for (const ry of [0, Math.PI]) {
    parts.push(flap(fwdRoot, fwdTip, ry), flap(aftRoot, aftTip, ry));
  }
  const details = new Mesh(mergeParts(parts), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }));
  details.castShadow = true;

  const engines = [...ring(3, 1.3, Math.PI / 2, 0.65, 1.7), ...ring(3, 3.1, -Math.PI / 2, 1.15, 2.6)];
  const cluster = engineCluster(engines, 0.08);
  object.add(hull, details, cluster.group);
  return { object, height: SHIP_H, radius: R, engineCount: engines.length, setEnginesLit: cluster.setLit };
}
