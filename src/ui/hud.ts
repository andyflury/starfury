import type { HintIcon, Hud, SpeedLight } from '../types.ts';
import { createControllerHint } from './controllerHint.ts';
import { el, replay, svgBox } from './dom.ts';
import { ICONS } from './icons.ts';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

interface Bar {
  root: HTMLElement;
  fill: HTMLElement;
  band: HTMLElement;
}

function createBar(parent: HTMLElement, kind: 'throttle' | 'fuel' | 'heat' | 'pressure', icon: string): Bar {
  const side = kind === 'throttle' ? 'left' : 'right';
  const root = el('div', `hud-item hud-glass hud-bar hud-bar-${side} hud-bar-${kind}`, parent);
  const track = el('div', 'hud-bar-track', root);
  const band = el('div', 'hud-bar-band', track);
  band.style.display = 'none';
  const fill = el('div', 'hud-bar-fill', track);
  el('div', 'hud-bar-ticks', track);
  svgBox('hud-bar-icon', icon, root);
  return { root, fill, band };
}

/** Radius of the level's dial in its SVG units; the rim stands for `edge` degrees. */
const DIAL_R = 88;
const DOT_R = 13;
const TILT_EDGE = 30;
/** Fraction of `edge` from which the dot turns red and pulses. */
const TILT_RIM = 0.8;

/** Creates the stage HUD inside `parent`; every element starts hidden. */
export function createHud(parent: HTMLElement): Hud {
  const root = el('div', 'hud', parent);
  const show = (node: HTMLElement, on: boolean): void => {
    node.classList.toggle('on', on);
  };

  const throttle = createBar(root, 'throttle', ICONS.flame);
  const fuel = createBar(root, 'fuel', ICONS.fuel);
  const heat = createBar(root, 'heat', ICONS.thermometer);
  const pressure = createBar(root, 'pressure', ICONS.pressure);

  /** Shows a right-hand bar at `level`, amber while `warn` holds and red and pulsing while `critical` holds. */
  const setLevel = (bar: Bar, level: number | undefined, warn: (v: number) => boolean, critical: (v: number) => boolean): void => {
    show(bar.root, level !== undefined);
    if (level === undefined) return;
    const v = clamp01(level);
    bar.fill.style.height = `${v * 100}%`;
    bar.root.classList.toggle('warn', warn(v) && !critical(v));
    bar.root.classList.toggle('critical', critical(v));
  };

  const speed = el('div', 'hud-item hud-glass hud-speed', root);
  speed.innerHTML = `<div class="hud-speed-arrow">${ICONS.downArrow}</div>
    <div class="lamp lamp-red"></div><div class="lamp lamp-yellow"></div><div class="lamp lamp-green"></div>`;

  const countdown = el('div', 'hud-item hud-countdown', root);
  const digit = el('div', 'hud-countdown-digit', countdown);

  const tilt = svgBox(
    'hud-item hud-tilt',
    `<svg viewBox="-100 -100 200 200" aria-hidden="true">
      <defs><radialGradient id="tilt-shade" cx="0" cy="0" r="${DIAL_R}" gradientUnits="userSpaceOnUse">
        <stop class="tilt-stop-safe" offset="0.33" stop-color="#ffc21f" stop-opacity="0.8"/>
        <stop class="tilt-stop-mid" offset="0.7" stop-color="#ff8a1a" stop-opacity="0.9"/>
        <stop offset="1" stop-color="#ff3d5a" stop-opacity="0.95"/>
      </radialGradient></defs>
      <circle class="tilt-dial" r="${DIAL_R}" fill="url(#tilt-shade)"/>
      <circle class="tilt-safe" r="29"/>
      <path class="tilt-cross" d="M-12 0 H12 M0 -12 V12"/>
      <g class="tilt-dot"><circle class="tilt-halo" r="${DOT_R * 1.9}"/><circle class="tilt-ring" r="${DOT_R + 4}"/><circle class="tilt-core" r="${DOT_R}"/></g>
    </svg>`,
    root,
  );
  const safeDisc = tilt.querySelector('.tilt-safe');
  const safeStop = tilt.querySelector('.tilt-stop-safe');
  const midStop = tilt.querySelector('.tilt-stop-mid');
  const dot = tilt.querySelector('.tilt-dot');
  let tiltZones = '';

  const hintBox = el('div', 'hud-item hud-hint', root);
  const hint = createControllerHint(hintBox, 'throttle-up');

  const pips = el('div', 'hud-item hud-pips', root);
  let pipsLit = 0;

  let lastDigit: number | undefined;
  let lastHint: HintIcon | undefined;

  const hud: Hud = {
    setThrottle(level, bandFrom, bandTo) {
      show(throttle.root, level !== undefined);
      if (level === undefined) return;
      const v = clamp01(level);
      const to = clamp01(bandTo ?? 1);
      throttle.fill.style.height = `${v * 100}%`;
      throttle.band.style.display = bandFrom === undefined ? 'none' : '';
      if (bandFrom !== undefined) {
        throttle.band.style.top = `${(1 - to) * 100}%`;
        throttle.band.style.height = `${(to - clamp01(bandFrom)) * 100}%`;
        throttle.band.classList.toggle('closed', to < 1);
      }
      throttle.root.classList.toggle('in-band', bandFrom !== undefined && v >= bandFrom && v <= to);
    },
    setFuel(level) {
      setLevel(fuel, level, (v) => v < 0.4, (v) => v < 0.2);
    },
    setHeat(level) {
      setLevel(heat, level, (v) => v >= 0.6, (v) => v >= 0.8);
    },
    setPressure(level, redFrom) {
      const red = clamp01(redFrom ?? 0.8);
      setLevel(pressure, level, (v) => v >= red - 0.2, (v) => v >= red);
      pressure.band.style.display = redFrom === undefined ? 'none' : '';
      pressure.band.style.top = '0';
      pressure.band.style.height = `${(1 - red) * 100}%`;
    },
    setPips(filled, total) {
      show(pips, filled !== undefined);
      if (filled === undefined) return;
      const n = Math.max(0, Math.round(total ?? pips.childElementCount));
      if (pips.childElementCount !== n) {
        pips.replaceChildren();
        for (let i = 0; i < n; i++) el('div', 'pip', pips);
        pipsLit = 0;
      }
      const lit = Math.max(0, Math.min(n, Math.round(filled)));
      [...pips.children].forEach((pip, i) => {
        pip.classList.toggle('lit', i < lit);
        if (i >= pipsLit && i < lit) replay(pip, 'pop');
      });
      pipsLit = lit;
    },
    setSpeedLight(light: SpeedLight | undefined) {
      show(speed, light !== undefined);
      if (light !== undefined) speed.dataset.light = light;
    },
    setCountdown(n) {
      show(countdown, n !== undefined);
      if (n === undefined || n === lastDigit) {
        lastDigit = n;
        return;
      }
      lastDigit = n;
      digit.textContent = String(n);
      replay(digit, 'pop');
    },
    setTilt(right, away, safe, edge) {
      show(tilt, right !== undefined);
      if (right === undefined) return;
      const rim = edge ?? TILT_EDGE;
      const green = safe ?? rim / 3;
      const zones = `${green}/${rim}`;
      if (zones !== tiltZones) {
        tiltZones = zones;
        const f = Math.min(1, green / rim);
        safeDisc?.setAttribute('r', (f * DIAL_R).toFixed(1));
        safeStop?.setAttribute('offset', f.toFixed(3));
        midStop?.setAttribute('offset', (f + (1 - f) * 0.6).toFixed(3));
      }
      const x = right;
      const y = away ?? 0;
      const mag = Math.hypot(x, y);
      const reach = DIAL_R - DOT_R;
      const k = mag === 0 ? 0 : Math.min(mag / rim, 1) * (reach / mag);
      dot?.setAttribute('transform', `translate(${(x * k).toFixed(2)} ${(-y * k).toFixed(2)})`);
      const state = mag <= green ? 'safe' : mag < rim * TILT_RIM ? 'warn' : 'danger';
      if (tilt.dataset.state !== state) tilt.dataset.state = state;
    },
    setHint(icon) {
      show(hintBox, icon !== undefined);
      if (icon === undefined || icon === lastHint) {
        lastHint = icon;
        return;
      }
      lastHint = icon;
      hint.set(icon);
      replay(hintBox, 'pop');
    },
    clear() {
      hud.setThrottle(undefined);
      hud.setFuel(undefined);
      hud.setHeat(undefined);
      hud.setPressure(undefined);
      hud.setPips(undefined);
      hud.setSpeedLight(undefined);
      hud.setCountdown(undefined);
      hud.setTilt(undefined);
      hud.setHint(undefined);
    },
  };
  return hud;
}
