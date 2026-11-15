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

function createBar(parent: HTMLElement, side: 'left' | 'right', icon: string): Bar {
  const root = el('div', `hud-item hud-glass hud-bar hud-bar-${side}`, parent);
  const track = el('div', 'hud-bar-track', root);
  const band = el('div', 'hud-bar-band', track);
  band.style.display = 'none';
  const fill = el('div', 'hud-bar-fill', track);
  el('div', 'hud-bar-ticks', track);
  svgBox('hud-bar-icon', icon, root);
  return { root, fill, band };
}

const TILT_ARC = 'M20 110 A90 90 0 0 1 200 110';

/** Point on the tilt dial at `deg` from upright, ±90 at the ends of the arc. */
function dialPoint(deg: number, r: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(110 + r * Math.sin(a)).toFixed(1)} ${(110 - r * Math.cos(a)).toFixed(1)}`;
}

/** Creates the stage HUD inside `parent`; every element starts hidden. */
export function createHud(parent: HTMLElement): Hud {
  const root = el('div', 'hud', parent);

  const throttle = createBar(root, 'left', ICONS.flame);
  const fuel = createBar(root, 'right', ICONS.fuel);

  const speed = el('div', 'hud-item hud-glass hud-speed', root);
  speed.innerHTML = `<div class="hud-speed-arrow">${ICONS.downArrow}</div>
    <div class="lamp lamp-red"></div><div class="lamp lamp-yellow"></div><div class="lamp lamp-green"></div>`;

  const countdown = el('div', 'hud-item hud-countdown', root);
  const digit = el('div', 'hud-countdown-digit', countdown);

  const tilt = svgBox('hud-item hud-tilt', '', root);
  const renderTiltDial = (limit: number | undefined): number => {
    const range = limit === undefined ? 45 : limit * 1.5;
    const safe = limit === undefined ? 10 : limit * 0.5;
    const zone = (from: number, to: number): string => {
      const s = dialPoint((from / range) * 90, 90);
      const e = dialPoint((to / range) * 90, 90);
      return `<path class="tilt-zone" d="M${s} A90 90 0 0 ${to > from ? 1 : 0} ${e}"/>`;
    };
    const zones = limit === undefined ? '' : zone(limit, range) + zone(-limit, -range);
    tilt.innerHTML = `<svg viewBox="0 0 220 140" aria-hidden="true">
      <path class="tilt-track" d="${TILT_ARC}"/>${zones}
      <path class="tilt-safe" d="M${dialPoint((-safe / range) * 90, 90)} A90 90 0 0 1 ${dialPoint((safe / range) * 90, 90)}"/>
      <g class="tilt-needle"><line x1="110" y1="110" x2="110" y2="30"/><circle cx="110" cy="110" r="11"/></g>
    </svg>`;
    return range;
  };
  let tiltRange = renderTiltDial(undefined);
  let tiltLimit: number | undefined;

  const hintBox = el('div', 'hud-item hud-hint', root);
  const hint = createControllerHint(hintBox, 'throttle-up');

  const show = (node: HTMLElement, on: boolean): void => {
    node.classList.toggle('on', on);
  };
  let lastDigit: number | undefined;
  let lastHint: HintIcon | undefined;

  const hud: Hud = {
    setThrottle(level, bandFrom) {
      show(throttle.root, level !== undefined);
      if (level === undefined) return;
      const v = clamp01(level);
      throttle.fill.style.height = `${v * 100}%`;
      throttle.band.style.display = bandFrom === undefined ? 'none' : '';
      if (bandFrom !== undefined) throttle.band.style.height = `${(1 - clamp01(bandFrom)) * 100}%`;
      throttle.root.classList.toggle('in-band', bandFrom !== undefined && v >= bandFrom);
    },
    setFuel(level) {
      show(fuel.root, level !== undefined);
      if (level === undefined) return;
      const v = clamp01(level);
      fuel.fill.style.height = `${v * 100}%`;
      fuel.root.classList.toggle('fuel-low', v < 0.4 && v >= 0.2);
      fuel.root.classList.toggle('fuel-critical', v < 0.2);
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
    setTilt(degrees, limit) {
      show(tilt, degrees !== undefined);
      if (degrees === undefined) return;
      if (limit !== tiltLimit) {
        tiltLimit = limit;
        tiltRange = renderTiltDial(limit);
      }
      const a = Math.max(-1, Math.min(1, degrees / tiltRange)) * 90;
      tilt.style.setProperty('--tilt', `${a}deg`);
      tilt.classList.toggle('tilt-danger', limit !== undefined && Math.abs(degrees) >= limit * 0.8);
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
      hud.setSpeedLight(undefined);
      hud.setCountdown(undefined);
      hud.setTilt(undefined);
      hud.setHint(undefined);
    },
  };
  return hud;
}
