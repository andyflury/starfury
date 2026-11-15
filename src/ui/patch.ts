import type { Sfx } from '../types.ts';
import { createControllerHint } from './controllerHint.ts';
import { el, type Screen } from './dom.ts';
import { ICONS } from './icons.ts';
import { ADVANCE, LETTERS, WORD } from './wordmark.ts';

const W = 1200;
const H = 1140;
const CX = 600;
const CY = 520;
const R = 480;
const BAND_OUT = 440;
const BAND_IN = 345;
const FIELD = 337;
const TEXT_R = (BAND_OUT + BAND_IN) / 2;
const NAVY = '#0a1230';
const FONT = `900 64px 'Arial Black', 'Segoe UI Black', Impact, sans-serif`;

const STAR_FIRST = 1.0;
const STAR_GAP = 0.55;
const STAR_POP = 0.35;

function circle(r: number): Path2D {
  const p = new Path2D();
  p.arc(CX, CY, r, 0, Math.PI * 2);
  return p;
}

function ring(outer: number, inner: number): Path2D {
  const p = new Path2D();
  p.arc(CX, CY, outer, 0, Math.PI * 2);
  p.arc(CX, CY, inner, 0, Math.PI * 2, true);
  return p;
}

/** Fills `path` and lays parallel thread lines over it at `angle` degrees. */
function threaded(ctx: CanvasRenderingContext2D, path: Path2D, fill: string | CanvasGradient, angle: number, thread: string, gap = 6): void {
  ctx.fillStyle = fill;
  ctx.fill(path, 'evenodd');
  ctx.save();
  ctx.clip(path, 'evenodd');
  ctx.translate(CX, CY);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.strokeStyle = thread;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = -H; y <= H; y += gap) {
    ctx.moveTo(-W, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** A dashed running stitch along `path`. */
function stitch(ctx: CanvasRenderingContext2D, path: Path2D, color: string, width = 4): void {
  ctx.save();
  ctx.setLineDash([12, 8]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.restore();
}

/** Radial satin stitches filling the ring between `inner` and `outer`. */
function satinRing(ctx: CanvasRenderingContext2D, outer: number, inner: number, a: string, b: string): void {
  ctx.fillStyle = a;
  ctx.fill(ring(outer, inner), 'evenodd');
  ctx.lineWidth = 3;
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * Math.PI * 2;
    const twist = 0.03;
    ctx.strokeStyle = i % 2 === 0 ? b : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(t) * (inner + 1), CY + Math.sin(t) * (inner + 1));
    ctx.lineTo(CX + Math.cos(t + twist) * (outer - 1), CY + Math.sin(t + twist) * (outer - 1));
    ctx.stroke();
  }
}

function drawLetter(ctx: CanvasRenderingContext2D, letter: string, scale: number): void {
  const path = new Path2D(LETTERS[letter] ?? '');
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-32, -40);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 30;
  ctx.stroke(path);
  const g = ctx.createLinearGradient(0, 0, 0, 80);
  g.addColorStop(0, '#fff6c2');
  g.addColorStop(0.45, '#ffc21f');
  g.addColorStop(1, '#ff4a12');
  ctx.strokeStyle = g;
  ctx.lineWidth = 18;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 4;
  ctx.translate(-2, -4);
  ctx.stroke(path);
  ctx.restore();
}

function drawWordArc(ctx: CanvasRenderingContext2D): void {
  const scale = 0.82;
  const step = (ADVANCE * scale) / TEXT_R;
  const start = -Math.PI / 2 - (step * (WORD.length - 1)) / 2;
  [...WORD].forEach((c, i) => {
    const a = start + i * step;
    ctx.save();
    ctx.translate(CX + Math.cos(a) * TEXT_R, CY + Math.sin(a) * TEXT_R);
    ctx.rotate(a + Math.PI / 2);
    drawLetter(ctx, c, scale);
    ctx.restore();
  });
}

function starPath(r: number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) p.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  p.closePath();
  return p;
}

function drawField(ctx: CanvasRenderingContext2D): void {
  const field = circle(FIELD);
  const sky = ctx.createLinearGradient(0, CY - FIELD, 0, CY + FIELD);
  sky.addColorStop(0, '#0e1d5c');
  sky.addColorStop(0.45, '#2b3fa8');
  sky.addColorStop(0.68, '#8a4bc4');
  sky.addColorStop(0.8, '#ff8a3d');
  threaded(ctx, field, sky, -30, 'rgba(255,255,255,0.06)');
  ctx.save();
  ctx.clip(field);

  ctx.fillStyle = '#ffffff';
  const twinkles: Array<[number, number, number]> = [
    [-230, -170, 7], [-160, -250, 5], [180, -230, 8], [250, -120, 5], [-270, -40, 5], [140, -150, 4], [-90, -200, 4], [230, -20, 6],
  ];
  for (const [x, y, r] of twinkles) {
    ctx.save();
    ctx.translate(CX + x, CY + y);
    ctx.fill(starPath(r * 1.6));
    ctx.restore();
  }

  ctx.translate(0, -60);
  const sea = new Path2D();
  sea.rect(CX - FIELD, CY + 150, FIELD * 2, FIELD);
  threaded(ctx, sea, '#1f6fb8', 0, 'rgba(255,255,255,0.12)', 9);
  const ground = new Path2D();
  ground.moveTo(CX - FIELD, CY + 175);
  ground.quadraticCurveTo(CX, CY + 150, CX + FIELD, CY + 190);
  ground.lineTo(CX + FIELD, CY + FIELD);
  ground.lineTo(CX - FIELD, CY + FIELD);
  ground.closePath();
  threaded(ctx, ground, '#d8b26a', 20, 'rgba(90,60,20,0.18)', 7);

  const towerX = CX - 120;
  const towerTop = CY - 215;
  const towerBase = CY + 168;
  const tower = new Path2D();
  tower.rect(towerX - 26, towerTop, 52, towerBase - towerTop);
  threaded(ctx, tower, '#3a4866', 90, 'rgba(255,255,255,0.08)', 5);
  ctx.strokeStyle = '#9fb3d6';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let y = towerTop; y < towerBase - 1; y += 38) {
    ctx.moveTo(towerX - 24, y);
    ctx.lineTo(towerX + 24, y + 38);
    ctx.moveTo(towerX + 24, y);
    ctx.lineTo(towerX - 24, y + 38);
    ctx.moveTo(towerX - 26, y);
    ctx.lineTo(towerX + 26, y);
  }
  ctx.stroke();
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 5;
  ctx.stroke(tower);
  const arms = new Path2D();
  arms.rect(towerX + 26, CY - 104, 108, 14);
  arms.rect(towerX + 26, CY - 72, 108, 14);
  threaded(ctx, arms, '#ffb21f', 0, 'rgba(120,60,0,0.25)', 5);
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 4;
  ctx.stroke(arms);
  const crane = new Path2D();
  crane.rect(towerX - 34, towerTop - 18, 68, 20);
  threaded(ctx, crane, '#e8eef7', 0, 'rgba(0,0,0,0.12)', 5);
  ctx.stroke(crane);

  const rx = CX + 40;
  const flame = new Path2D();
  flame.moveTo(rx - 34, CY + 92);
  flame.quadraticCurveTo(rx - 40, CY + 170, rx, CY + 250);
  flame.quadraticCurveTo(rx + 40, CY + 170, rx + 34, CY + 92);
  flame.closePath();
  threaded(ctx, flame, '#ff6a1a', 90, 'rgba(255,220,80,0.5)', 6);
  const core = new Path2D();
  core.moveTo(rx - 20, CY + 92);
  core.quadraticCurveTo(rx - 18, CY + 150, rx, CY + 190);
  core.quadraticCurveTo(rx + 18, CY + 150, rx + 20, CY + 92);
  core.closePath();
  ctx.fillStyle = '#fff2a8';
  ctx.fill(core);

  ctx.fillStyle = '#f4f1ea';
  for (const [x, y, r] of [[-60, 185, 46], [70, 196, 54], [-150, 200, 40], [170, 205, 46], [0, 210, 40]] as const) {
    const puff = circle(r);
    ctx.save();
    ctx.translate(x, y);
    threaded(ctx, puff, '#f4f1ea', 45, 'rgba(120,120,140,0.18)', 6);
    ctx.restore();
  }

  const steel = ctx.createLinearGradient(rx - 32, 0, rx + 32, 0);
  steel.addColorStop(0, '#8d99a8');
  steel.addColorStop(0.35, '#f2f5f9');
  steel.addColorStop(1, '#7c8797');
  const body = new Path2D();
  body.moveTo(rx - 30, CY + 94);
  body.lineTo(rx - 30, CY - 170);
  body.bezierCurveTo(rx - 30, CY - 225, rx - 8, CY - 258, rx, CY - 265);
  body.bezierCurveTo(rx + 8, CY - 258, rx + 30, CY - 225, rx + 30, CY - 170);
  body.lineTo(rx + 30, CY + 94);
  body.closePath();
  threaded(ctx, body, steel, 90, 'rgba(0,0,0,0.07)', 5);
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 6;
  ctx.stroke(body);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(rx - 30, CY - 40);
  ctx.lineTo(rx + 30, CY - 40);
  ctx.stroke();
  const fins = new Path2D();
  fins.rect(rx - 46, CY - 22, 16, 22);
  fins.rect(rx + 30, CY - 22, 16, 22);
  fins.moveTo(rx - 30, CY - 210);
  fins.lineTo(rx - 50, CY - 185);
  fins.lineTo(rx - 30, CY - 180);
  fins.closePath();
  fins.moveTo(rx + 30, CY - 210);
  fins.lineTo(rx + 50, CY - 185);
  fins.lineTo(rx + 30, CY - 180);
  fins.closePath();
  fins.moveTo(rx - 30, CY - 80);
  fins.lineTo(rx - 54, CY - 50);
  fins.lineTo(rx - 30, CY - 46);
  fins.closePath();
  fins.moveTo(rx + 30, CY - 80);
  fins.lineTo(rx + 54, CY - 50);
  fins.lineTo(rx + 30, CY - 46);
  fins.closePath();
  threaded(ctx, fins, '#5d6a7e', 0, 'rgba(255,255,255,0.12)', 5);
  ctx.lineWidth = 4;
  ctx.stroke(fins);
  ctx.restore();
}

interface Ribbon {
  path: Path2D;
  /** Midline of the main band, t from 0 at the left end to 1 at the right. */
  mid(t: number): { x: number; y: number; angle: number };
}

const RIB_HALF = 470;
const RIB_TOP = CY + 150;
const RIB_SAG = 34;
const RIB_H = 86;

function ribbonCurve(t: number, yEnd: number): { x: number; y: number } {
  const x0 = CX - RIB_HALF;
  const x2 = CX + RIB_HALF;
  const yC = yEnd + RIB_SAG * 2;
  const u = 1 - t;
  return { x: u * u * x0 + 2 * u * t * CX + t * t * x2, y: u * u * yEnd + 2 * u * t * yC + t * t * yEnd };
}

function ribbon(): Ribbon {
  const path = new Path2D();
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const p = ribbonCurve(i / n, RIB_TOP);
    if (i === 0) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
  }
  for (let i = n; i >= 0; i--) {
    const p = ribbonCurve(i / n, RIB_TOP + RIB_H);
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return {
    path,
    mid(t) {
      const a = ribbonCurve(t, RIB_TOP + RIB_H / 2);
      const b = ribbonCurve(Math.min(1, t + 0.001), RIB_TOP + RIB_H / 2);
      const c = ribbonCurve(Math.max(0, t - 0.001), RIB_TOP + RIB_H / 2);
      return { x: a.x, y: a.y, angle: Math.atan2(b.y - c.y, b.x - c.x) };
    },
  };
}

function drawRibbon(ctx: CanvasRenderingContext2D, name: string): void {
  for (const side of [-1, 1]) {
    const x0 = CX + side * (RIB_HALF - 40);
    const xEnd = CX + side * (RIB_HALF + 110);
    const top = RIB_TOP + 34;
    const tail = new Path2D();
    tail.moveTo(x0, top);
    tail.lineTo(xEnd, top);
    tail.lineTo(xEnd - side * 34, top + RIB_H / 2);
    tail.lineTo(xEnd, top + RIB_H);
    tail.lineTo(x0, top + RIB_H);
    tail.closePath();
    threaded(ctx, tail, '#a3201b', 0, 'rgba(0,0,0,0.15)', 6);
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 5;
    ctx.stroke(tail);
    const fold = new Path2D();
    fold.moveTo(CX + side * (RIB_HALF - 40), top);
    fold.lineTo(CX + side * RIB_HALF, RIB_TOP + RIB_H);
    fold.lineTo(CX + side * (RIB_HALF - 40), top + RIB_H);
    fold.closePath();
    ctx.fillStyle = '#5e0f0c';
    ctx.fill(fold);
  }
  const r = ribbon();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#e2332b';
  ctx.fill(r.path);
  ctx.restore();
  threaded(ctx, r.path, '#e2332b', 0, 'rgba(255,255,255,0.08)', 6);
  ctx.strokeStyle = '#ffc21f';
  ctx.lineWidth = 8;
  ctx.stroke(r.path);
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 3;
  ctx.stroke(r.path);

  if (name.length === 0) return;
  ctx.font = FONT;
  const widths = [...name].map((c) => ctx.measureText(c).width + 6);
  const total = widths.reduce((s, w) => s + w, 0);
  const avail = RIB_HALF * 2 - 140;
  const k = Math.min(1, avail / total);
  const span = (total * k) / (RIB_HALF * 2);
  let t = 0.5 - span / 2;
  ctx.lineJoin = 'round';
  for (const [i, c] of [...name].entries()) {
    const w = (widths[i] ?? 0) * k;
    const m = r.mid(t + w / 2 / (RIB_HALF * 2));
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.scale(k, k);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 10;
    ctx.strokeText(c, 0, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c, 0, 4);
    ctx.restore();
    t += w / (RIB_HALF * 2);
  }
}

function drawBase(ctx: CanvasRenderingContext2D, name: string): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = NAVY;
  ctx.fill(circle(R));
  ctx.restore();
  satinRing(ctx, R, BAND_OUT + 8, '#f2b81f', '#c98a0c');
  ctx.fillStyle = NAVY;
  ctx.fill(ring(BAND_OUT + 8, BAND_OUT), 'evenodd');
  threaded(ctx, ring(BAND_OUT, BAND_IN), '#1b2a6b', 0, 'rgba(255,255,255,0.07)', 5);
  stitch(ctx, circle(BAND_OUT - 8), '#3ee6ff', 3);
  satinRing(ctx, BAND_IN, FIELD, '#e9eef7', '#b9c3d6');
  drawField(ctx);
  stitch(ctx, circle(FIELD - 8), 'rgba(255,255,255,0.55)', 3);
  drawWordArc(ctx);
  drawRibbon(ctx, name);
}

function starAngles(max: number): number[] {
  const step = Math.min((12 * Math.PI) / 180, (100 * Math.PI) / 180 / Math.max(1, max));
  const start = Math.PI / 2 + (step * (max - 1)) / 2;
  return Array.from({ length: max }, (_, i) => start - i * step);
}

const easeOutBack = (t: number): number => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** The mission patch screen. */
export interface PatchScreen extends Screen {
  /** Advances the star animation; called once per frame. */
  update(dt: number): void;
  /** Resolves once every earned star has landed. */
  readonly landed: Promise<void>;
  /** Shows the flip-the-switch hint. */
  showHint(): void;
}

/** Mounts the patch for `name` with `stars` of `max` stars landing one by one, each with `sfx.star()`. */
export function showPatch(overlay: HTMLElement, name: string, stars: number, max: number, sfx: Sfx): PatchScreen {
  const root = el('div', 'screen patch', overlay);
  const canvas = el('canvas', 'patch-canvas', root);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const baseCtx = base.getContext('2d');
  if (!baseCtx) throw new Error('2D canvas unavailable');
  drawBase(baseCtx, name);

  const download = el('button', 'corner-button corner-bottom-right', root);
  download.innerHTML = ICONS.download;
  download.addEventListener('pointerdown', (e) => e.stopPropagation());
  download.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `starfury-${name.toLowerCase() || 'patch'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });
  const hint = el('div', 'panel patch-hint', root);
  createControllerHint(hint, 'flip');

  const angles = starAngles(max);
  const starR = Math.min(38, ((angles.length > 1 ? Math.abs((angles[0] ?? 0) - (angles[1] ?? 0)) : 0.3) * TEXT_R) * 0.48);
  const earned = Math.min(stars, max);
  const lastLanding = STAR_FIRST + (earned - 1) * STAR_GAP;
  let time = 0;
  let played = 0;
  let resolveLanded: () => void = () => {};
  const landed = new Promise<void>((r) => {
    resolveLanded = r;
  });

  const draw = (): void => {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    angles.forEach((a, i) => {
      const x = CX + Math.cos(a) * TEXT_R;
      const y = CY + Math.sin(a) * TEXT_R;
      const since = time - (STAR_FIRST + i * STAR_GAP);
      const filled = i < earned && since >= 0;
      const path = starPath(starR);
      ctx.save();
      ctx.translate(x, y);
      if (filled) {
        const p = Math.min(1, since / STAR_POP);
        const s = 2.4 - 1.4 * easeOutBack(p);
        if (p < 1) {
          ctx.strokeStyle = `rgba(255,236,140,${1 - p})`;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(0, 0, starR * (1 + p * 1.6), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.scale(s, s);
        ctx.fillStyle = '#ffcc2e';
        ctx.fill(path);
        ctx.save();
        ctx.clip(path);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = -starR; k < starR; k += 4) {
          ctx.moveTo(k, -starR);
          ctx.lineTo(k + starR, starR);
        }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = NAVY;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      } else {
        ctx.fillStyle = '#0d1640';
        ctx.fill(path);
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = '#6f80b8';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
        ctx.restore();
      }
      ctx.restore();
    });
  };
  draw();

  return {
    landed,
    update(dt) {
      time += dt;
      while (played < earned && time >= STAR_FIRST + played * STAR_GAP) {
        played++;
        sfx.star();
      }
      if (time <= Math.max(STAR_FIRST, lastLanding) + STAR_POP + dt) draw();
      if (time >= Math.max(STAR_FIRST, lastLanding + STAR_POP)) resolveLanded();
    },
    showHint() {
      hint.classList.add('on');
    },
    dispose() {
      root.remove();
    },
  };
}
