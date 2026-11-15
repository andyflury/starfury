import type { LineId, Voice } from '../types.ts';
import type { GameInput } from '../input/index.ts';
import {
  createArmDetector,
  createStickDetector,
  createThrottleBottomDetector,
  createThrottleTopDetector,
  type ArmMapping,
  type AxisCandidate,
  type Detector,
  type RawSnapshot,
  type StickMapping,
  type ThrottleMapping,
} from '../input/mapping.ts';
import './setupWizard.css';

type Step = 'connect' | 'throttle_up' | 'throttle_down' | 'x' | 'y' | 'arm' | 'done';

const LINES: Record<Step, LineId> = {
  connect: 'setup_connect',
  throttle_up: 'setup_throttle_up',
  throttle_down: 'throttle_down',
  x: 'setup_right_x',
  y: 'setup_right_y',
  arm: 'setup_arm',
  done: 'setup_done',
};
/** The step dots, each with the steps it covers. */
const DOTS: readonly (readonly Step[])[] = [['throttle_up', 'throttle_down'], ['x'], ['y'], ['arm'], ['done']];
const NEXT: Record<Step, Step> = { connect: 'throttle_up', throttle_up: 'throttle_down', throttle_down: 'x', x: 'y', y: 'arm', arm: 'done', done: 'done' };
const REPEAT_MS = 9000;
const TICK_MS = 800;
/** Seconds per demo cycle. */
const DEMO_S = 2.4;
/** Stick knob travel in SVG units at full deflection. */
const TRAVEL = 62;

const L = { x: 215, y: 300 };
const R = { x: 785, y: 300 };
const SWITCH = { x: 150, y: 112 };
/** Throttle bar of the confirmation screen, left of the transmitter. */
const BAR = { x: -150, y: 170, w: 90, h: 300 };
/** Steering square of the confirmation screen, right of the transmitter. */
const PAD = { x: 1000, y: 220, size: 160 };
const LAMP = { x: 30, y: 40 };
const SWAP = { x: BAR.x + BAR.w / 2, y: BAR.y + BAR.h + 72 };

const arrow = (cls: string, x: number, y: number, deg: number): string =>
  `<g class="sw-arrow ${cls}" transform="translate(${x} ${y}) rotate(${deg})"><polygon points="0,-42 38,0 15,0 15,40 -15,40 -15,0 -38,0"/></g>`;

const gimbal = (side: 'l' | 'r', c: { x: number; y: number }): string => `
  <g class="sw-gimbal sw-gimbal-${side}">
    <rect class="sw-plate" x="${c.x - 118}" y="${c.y - 118}" width="236" height="236" rx="34"/>
    <circle class="sw-ring" cx="${c.x}" cy="${c.y}" r="96"/>
    <circle class="sw-ring-inner" cx="${c.x}" cy="${c.y}" r="70"/>
    <path class="sw-cross" d="M${c.x - 96} ${c.y}H${c.x + 96}M${c.x} ${c.y - 96}V${c.y + 96}"/>
    <circle class="sw-boot" cx="${c.x}" cy="${c.y}" r="34"/>
    <g class="sw-stick sw-stick-${side}">
      <line class="sw-shaft" x1="${c.x}" y1="${c.y}" x2="${c.x}" y2="${c.y}"/>
      <circle class="sw-knob" cx="${c.x}" cy="${c.y}" r="30"/>
      <circle class="sw-knob-top" cx="${c.x - 8}" cy="${c.y - 9}" r="10"/>
    </g>
  </g>`;

const toggle = (x: number, cls: string): string => `
  <g class="sw-toggle ${cls}">
    <rect class="sw-toggle-base" x="${x - 26}" y="${SWITCH.y - 16}" width="52" height="30" rx="8"/>
    <g class="sw-lever"><line x1="${x}" y1="${SWITCH.y}" x2="${x}" y2="${SWITCH.y - 74}"/><circle cx="${x}" cy="${SWITCH.y - 78}" r="15"/></g>
  </g>`;

const FLAME = (x: number, y: number): string =>
  `<path class="sw-flame" transform="translate(${x} ${y})" d="M0 -40 C18 -18 30 -4 26 14 C22 32 10 40 0 40 C-10 40 -22 32 -26 14 C-30 -4 -14 -10 -8 -26 C-4 -14 4 -12 0 -40Z"/>` +
  `<path class="sw-flame-core" transform="translate(${x} ${y + 14})" d="M0 -18 C10 -6 14 4 10 14 C6 22 -6 22 -10 14 C-14 4 -6 -4 0 -18Z"/>`;

const WHEEL = (x: number, y: number): string =>
  `<g class="sw-wheel" transform="translate(${x} ${y})"><circle r="34"/><circle r="8"/><path d="M-8 0H-34M8 0H34M0 8V34"/></g>`;

/** The mapped controls drawn around the transmitter on the confirmation step. */
const MAP_OVERLAY = `
  <g class="sw-map">
    <path class="sw-link sw-link-throttle" d="M${BAR.x + BAR.w} ${L.y}H${L.x - 118}"/>
    <path class="sw-link sw-link-steer" d="M${R.x + 118} ${R.y}H${PAD.x}"/>
    <path class="sw-link sw-link-arm" d="M${LAMP.x + 34} ${LAMP.y + 10}L${SWITCH.x - 30} ${SWITCH.y - 40}"/>
    <rect class="sw-bar" x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="22"/>
    <rect class="sw-bar-fill" x="${BAR.x + 10}" y="${BAR.y + BAR.h - 10}" width="${BAR.w - 20}" height="0" rx="12"/>
    ${FLAME(BAR.x + BAR.w / 2, BAR.y - 58)}
    <g class="sw-button sw-swap" role="button" aria-label="swap">
      <circle cx="${SWAP.x}" cy="${SWAP.y}" r="40"/>
      <path transform="translate(${SWAP.x} ${SWAP.y})" d="M-12 22V-20M-24 -8L-12 -22L0 -8M12 -22V20M0 8L12 22L24 8"/>
    </g>
    <rect class="sw-pad" x="${PAD.x}" y="${PAD.y}" width="${PAD.size}" height="${PAD.size}" rx="22"/>
    <path class="sw-pad-cross" d="M${PAD.x + PAD.size / 2} ${PAD.y + 14}V${PAD.y + PAD.size - 14}M${PAD.x + 14} ${PAD.y + PAD.size / 2}H${PAD.x + PAD.size - 14}"/>
    <circle class="sw-pad-dot" cx="${PAD.x + PAD.size / 2}" cy="${PAD.y + PAD.size / 2}" r="20"/>
    ${WHEEL(PAD.x + PAD.size / 2, PAD.y - 62)}
    <circle class="sw-lamp" cx="${LAMP.x}" cy="${LAMP.y}" r="34"/>
  </g>`;

const TRANSMITTER = `
<svg class="sw-tx" viewBox="-190 -30 1380 720" aria-hidden="true">
  <g class="sw-cable"><path d="M500 690 V505"/><rect x="478" y="455" width="44" height="58" rx="10"/><rect class="sw-plug-tip" x="488" y="440" width="24" height="20" rx="4"/></g>
  ${toggle(150, 'sw-arm')}${toggle(255, '')}${toggle(745, '')}${toggle(850, '')}
  <path class="sw-body" d="M120 110H880Q935 110 940 165L960 480Q965 560 890 565H800Q745 565 735 515L718 440H282L265 515Q255 565 200 565H110Q35 560 40 480L60 165Q65 110 120 110Z"/>
  <path class="sw-body-edge" d="M130 132H870Q912 132 916 172L934 470"/>
  <rect class="sw-port" x="482" y="430" width="36" height="14" rx="5"/>
  <rect class="sw-screen-frame" x="415" y="142" width="170" height="112" rx="12"/>
  <rect class="sw-screen" x="429" y="155" width="142" height="86" rx="6"/>
  <path class="sw-screen-wave" d="M440 214 Q460 178 480 205 T520 198 T560 186"/>
  <g class="sw-keys"><rect x="430" y="286" width="56" height="26" rx="13"/><rect x="514" y="286" width="56" height="26" rx="13"/><circle cx="500" cy="360" r="28"/></g>
  <g class="sw-trims">
    <rect x="${L.x + 136}" y="${L.y - 90}" width="16" height="180" rx="8"/><rect x="${R.x - 152}" y="${R.y - 90}" width="16" height="180" rx="8"/>
  </g>
  ${gimbal('l', L)}${gimbal('r', R)}
  ${arrow('sw-a-l1', L.x, L.y - 150, 0)}${arrow('sw-a-l2', L.x, L.y + 150 + 60, 180)}
  ${arrow('sw-a-x1', R.x - 165, R.y, -90)}${arrow('sw-a-x2', R.x + 165, R.y, 90)}
  ${arrow('sw-a-y1', R.x, R.y - 150, 0)}${arrow('sw-a-y2', R.x, R.y + 150 + 60, 180)}
  <path class="sw-arrow sw-a-flip" d="M84 44 Q150 -6 210 38" />
  <polygon class="sw-arrow sw-a-flip" points="236,58 194,58 218,22"/>
  ${MAP_OVERLAY}
</svg>`;

const ACTIONS = `
<div class="sw-actions">
  <button class="sw-redo" type="button" aria-label="redo"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M74 34A30 30 0 1 0 80 58"/><polygon points="62,18 90,26 74,48"/></svg></button>
  <button class="sw-accept" type="button" aria-label="accept"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M24 52L42 70L78 32"/></svg></button>
  <svg class="sw-flip-hint" viewBox="0 0 200 220" aria-hidden="true">
    <rect class="sw-toggle-base" x="60" y="150" width="80" height="44" rx="12"/>
    <g class="sw-lever"><line x1="100" y1="170" x2="100" y2="60"/><circle cx="100" cy="54" r="22"/></g>
    <path class="sw-arrow" d="M30 60 Q100 -10 170 60"/><polygon class="sw-arrow" points="190,86 146,72 176,40"/>
  </svg>
</div>`;

const CLOSE = `<button class="sw-close" type="button" aria-label="close"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M30 30L70 70M70 30L30 70"/></svg></button>`;

const TICK = `<svg class="sw-tick" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="88"/><path d="M52 104 L86 138 L150 66"/></svg>`;

interface Found {
  top?: { axis: number; top: number };
  throttle?: ThrottleMapping;
  x?: StickMapping;
  y?: StickMapping;
  arm?: ArmMapping;
}

/** The running detection step: `push` returns true once it has stored its result. */
interface Active {
  push(raw: RawSnapshot, t: number): boolean;
  readonly candidate: AxisCandidate | undefined;
}

function watch<T>(detector: Detector<T>, store: (result: T) => void): Active {
  return {
    push(raw, t) {
      const r = detector.push(raw, t);
      if (r !== undefined) store(r);
      return r !== undefined;
    },
    get candidate() {
      return detector.candidate;
    },
  };
}

/** Which half of the demo cycle `seconds` falls in, and the demo position −1…+1 with the prompt's first direction positive. */
function demo(seconds: number): { first: boolean; value: number } {
  const p = (seconds % DEMO_S) / DEMO_S;
  const first = p < 0.5;
  const local = (p % 0.5) / 0.5;
  const swing = Math.sin(Math.min(1, local * 1.6) * Math.PI * 0.5);
  return { first, value: first ? swing : -swing };
}

/** The demo position of a one-way push: from −1 to +1 in the first 60 % of the cycle, then held. */
function push(seconds: number): number {
  const p = (seconds % DEMO_S) / DEMO_S;
  return -1 + 2 * Math.sin(Math.min(1, p / 0.6) * Math.PI * 0.5);
}

/**
 * Mounts the controller setup wizard into `overlay`; resolves once a mapping is stored and accepted, or when it is
 * closed (Escape or the close button).
 */
export function runSetupWizard(overlay: HTMLElement, voice: Voice, input: GameInput): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'sw';
    root.innerHTML = `<div class="sw-dots">${DOTS.map(() => '<i></i>').join('')}</div><div class="sw-stage">${TRANSMITTER}${ACTIONS}</div>${TICK}${CLOSE}`;
    overlay.append(root);
    const $ = <T extends Element>(sel: string): T => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`setup wizard: missing ${sel}`);
      return el;
    };
    const stickL = { shaft: $<SVGLineElement>('.sw-stick-l .sw-shaft'), knob: $<SVGGElement>('.sw-stick-l') };
    const stickR = { shaft: $<SVGLineElement>('.sw-stick-r .sw-shaft'), knob: $<SVGGElement>('.sw-stick-r') };
    const lever = $<SVGGElement>('.sw-arm .sw-lever');
    const barFill = $<SVGRectElement>('.sw-bar-fill');
    const padDot = $<SVGCircleElement>('.sw-pad-dot');
    const lamp = $<SVGCircleElement>('.sw-lamp');

    let step: Step = 'throttle_up';
    let stepStart = 0;
    let lineAt = 0;
    let tickUntil: number | undefined;
    let active: Active | undefined;
    let found: Found = {};
    let padId = '';
    let awaitingConfirm = false;
    let frame = 0;

    const placeStick = (s: typeof stickL, c: { x: number; y: number }, x: number, y: number): void => {
      const dx = x * TRAVEL;
      const dy = -y * TRAVEL;
      s.knob.querySelectorAll('circle').forEach((el) => el.setAttribute('transform', `translate(${dx} ${dy})`));
      s.shaft.setAttribute('x2', String(c.x + dx));
      s.shaft.setAttribute('y2', String(c.y + dy));
    };
    const placeLever = (deg: number): void => lever.setAttribute('transform', `rotate(${deg} ${SWITCH.x} ${SWITCH.y})`);

    const enter = (next: Step, now: number): void => {
      step = next;
      stepStart = now;
      lineAt = now;
      awaitingConfirm = false;
      root.dataset.step = next;
      root.classList.remove('sw-hint');
      const doneIndex = DOTS.findIndex((d) => d.includes(next));
      root.querySelectorAll<HTMLElement>('.sw-dots i').forEach((d, i) => {
        d.className = doneIndex < 0 ? '' : i < doneIndex ? 'done' : i === doneIndex ? 'now' : '';
      });
      const { top } = found;
      const assigned = [found.throttle?.axis, found.x?.axis, found.y?.axis].filter((a): a is number => a !== undefined);
      active =
        next === 'throttle_up'
          ? watch(createThrottleTopDetector([]), (r) => (found.top = r))
          : next === 'throttle_down' && top
            ? watch(createThrottleBottomDetector(top.axis, top.top), (bottom) => (found.throttle = { axis: top.axis, top: top.top, bottom }))
            : next === 'x'
              ? watch(createStickDetector(assigned, 'negative'), (r) => (found.x = r))
              : next === 'y'
                ? watch(createStickDetector(assigned, 'positive'), (r) => (found.y = r))
                : next === 'arm'
                  ? watch(createArmDetector(assigned), (r) => (found.arm = r))
                  : undefined;
      if (next !== 'throttle_down') placeStick(stickL, L, 0, next === 'throttle_up' ? -1 : 0);
      placeStick(stickR, R, 0, 0);
      placeLever(-28);
      if (next === 'done') {
        const { throttle, x, y, arm } = found;
        if (throttle && x && y && arm) input.setMapping({ padId, throttle, stickX: x, stickY: y, arm });
        const at = now;
        void voice.say(LINES.done).then(() => {
          if (step !== 'done' || stepStart !== at) return;
          root.classList.add('sw-hint');
          input.flush();
          awaitingConfirm = true;
        });
      } else void voice.say(LINES[next]);
    };

    const complete = (now: number): void => {
      voice.stop();
      tickUntil = now + TICK_MS;
      root.classList.add('sw-ticked');
      active = undefined;
    };

    const finish = (): void => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
      voice.stop();
      root.remove();
      resolve();
    };

    const redo = (): void => {
      input.setMapping(undefined);
      found = {};
      enter('throttle_up', performance.now());
    };

    const swapThrottle = (): void => {
      const m = input.mapping;
      if (m) input.setMapping({ ...m, throttle: { axis: m.throttle.axis, bottom: m.throttle.top, top: m.throttle.bottom } });
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.code === 'Backspace' && step === 'done') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey, true);

    const button = (sel: string, action: () => void): void => {
      const el = $<Element>(sel);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        action();
      });
    };
    button('.sw-close', finish);
    button('.sw-accept', finish);
    button('.sw-redo', redo);
    button('.sw-swap', swapThrottle);

    const drawCandidate = (c: AxisCandidate | undefined, sec: number): void => {
      const d = demo(sec);
      root.querySelectorAll('.sw-arrow.on').forEach((el) => el.classList.remove('on'));
      const lit = (cls: string): void => root.querySelectorAll(cls).forEach((el) => el.classList.add('on'));
      if (step === 'throttle_up') {
        lit('.sw-a-l1');
        placeStick(stickL, L, 0, c ? c.display : push(sec));
      } else if (step === 'throttle_down') {
        lit('.sw-a-l2');
        placeStick(stickL, L, 0, c ? c.display : -push(sec));
      } else if (step === 'x') {
        lit(d.first ? '.sw-a-x1' : '.sw-a-x2');
        placeStick(stickR, R, -(c ? c.display : d.value), 0);
      } else if (step === 'y') {
        lit(d.first ? '.sw-a-y1' : '.sw-a-y2');
        placeStick(stickR, R, 0, c ? c.display : d.value);
      } else if (step === 'arm') {
        lit('.sw-a-flip');
        const p = (sec % DEMO_S) / DEMO_S;
        placeLever(p < 0.35 ? -28 : p < 0.45 ? -28 + ((p - 0.35) / 0.1) * 56 : p < 0.85 ? 28 : 28 - ((p - 0.85) / 0.15) * 56);
      } else if (step === 'connect') {
        placeStick(stickL, L, 0, Math.sin(sec * 3) * 0.6);
        placeStick(stickR, R, Math.sin(sec * 2.3) * 0.6, 0);
      }
    };

    const drawMapped = (): void => {
      const s = input.state;
      placeStick(stickL, L, 0, s.throttle * 2 - 1);
      placeStick(stickR, R, s.stickX, s.stickY);
      placeLever(s.armed ? 28 : -28);
      const h = s.throttle * (BAR.h - 20);
      barFill.setAttribute('y', String(BAR.y + BAR.h - 10 - h));
      barFill.setAttribute('height', String(h));
      padDot.setAttribute('cx', String(PAD.x + PAD.size / 2 + s.stickX * (PAD.size / 2 - 24)));
      padDot.setAttribute('cy', String(PAD.y + PAD.size / 2 - s.stickY * (PAD.size / 2 - 24)));
      lamp.classList.toggle('on', s.armed);
    };

    const loop = (now: number): void => {
      frame = requestAnimationFrame(loop);
      input.poll();
      if (tickUntil !== undefined) {
        if (now < tickUntil) return;
        tickUntil = undefined;
        root.classList.remove('sw-ticked');
        enter(NEXT[step], now);
      }
      if (step !== 'done' && now - lineAt >= REPEAT_MS) {
        lineAt = now;
        void voice.say(LINES[step]);
      }
      const raw = input.raw;
      if (step === 'connect') {
        if (raw) complete(now);
      } else if (active && raw) {
        padId = raw.id;
        if (active.push(raw, now)) {
          if (step === 'throttle_up') enter('throttle_down', now);
          else complete(now);
        }
      }
      if (step === 'done') {
        drawMapped();
        if (awaitingConfirm && input.confirm) finish();
        return;
      }
      if (tickUntil === undefined) drawCandidate(active?.candidate, (now - stepStart) / 1000);
    };

    input.poll();
    enter(input.raw ? 'throttle_up' : 'connect', performance.now());
    frame = requestAnimationFrame(loop);
  });
}
