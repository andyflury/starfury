import type { LineId, Voice } from '../types.ts';
import type { GameInput } from '../input/index.ts';
import {
  createArmDetector,
  createStickDetector,
  createThrottleDetector,
  type ArmMapping,
  type AxisCandidate,
  type Detector,
  type RawSnapshot,
  type StickMapping,
  type ThrottleMapping,
} from '../input/mapping.ts';
import './setupWizard.css';

type Step = 'connect' | 'throttle' | 'x' | 'y' | 'arm' | 'done';

const LINES: Record<Step, LineId> = {
  connect: 'setup_connect',
  throttle: 'setup_throttle',
  x: 'setup_right_x',
  y: 'setup_right_y',
  arm: 'setup_arm',
  done: 'setup_done',
};
const DOTS: readonly Step[] = ['throttle', 'x', 'y', 'arm', 'done'];
const REPEAT_MS = 9000;
const TICK_MS = 800;
/** Seconds per demo cycle: first direction for half of it, second direction for the other half. */
const DEMO_S = 2.4;
/** Stick knob travel in SVG units at full deflection. */
const TRAVEL = 62;

const L = { x: 215, y: 300 };
const R = { x: 785, y: 300 };
const SWITCH = { x: 150, y: 112 };

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

const TRANSMITTER = `
<svg class="sw-tx" viewBox="0 0 1000 690" aria-hidden="true">
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
</svg>`;

const LIVE = `
<div class="sw-live">
  <div class="sw-gauge sw-throttle"><div class="sw-throttle-fill"></div></div>
  <div class="sw-gauge sw-pad"><div class="sw-pad-cross"></div><div class="sw-pad-dot"></div></div>
  <div class="sw-gauge sw-lamp-cell"><div class="sw-lamp"></div>
    <svg class="sw-flip-hint" viewBox="0 0 200 220" aria-hidden="true">
      <rect class="sw-toggle-base" x="60" y="150" width="80" height="44" rx="12"/>
      <g class="sw-lever"><line x1="100" y1="170" x2="100" y2="60"/><circle cx="100" cy="54" r="22"/></g>
      <path class="sw-arrow" d="M30 60 Q100 -10 170 60"/><polygon class="sw-arrow" points="190,86 146,72 176,40"/>
    </svg>
  </div>
</div>`;

const TICK = `<svg class="sw-tick" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="88"/><path d="M52 104 L86 138 L150 66"/></svg>`;

interface Found {
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

/** Mounts the controller setup wizard into `overlay`; resolves once a mapping is stored and confirmed, or on Escape. */
export function runSetupWizard(overlay: HTMLElement, voice: Voice, input: GameInput): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'sw';
    root.innerHTML = `<div class="sw-dots">${DOTS.map((s) => `<i data-dot="${s}"></i>`).join('')}</div><div class="sw-stage">${TRANSMITTER}${LIVE}</div>${TICK}`;
    overlay.append(root);
    const $ = <T extends Element>(sel: string): T => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`setup wizard: missing ${sel}`);
      return el;
    };
    const stickL = { shaft: $<SVGLineElement>('.sw-stick-l .sw-shaft'), knob: $<SVGGElement>('.sw-stick-l') };
    const stickR = { shaft: $<SVGLineElement>('.sw-stick-r .sw-shaft'), knob: $<SVGGElement>('.sw-stick-r') };
    const lever = $<SVGGElement>('.sw-arm .sw-lever');
    const throttleFill = $<HTMLElement>('.sw-throttle-fill');
    const padDot = $<HTMLElement>('.sw-pad-dot');
    const lamp = $<HTMLElement>('.sw-lamp');

    let step: Step = 'throttle';
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
      const doneIndex = DOTS.indexOf(next);
      root.querySelectorAll<HTMLElement>('[data-dot]').forEach((d, i) => {
        d.className = next === 'connect' ? '' : i < doneIndex ? 'done' : i === doneIndex ? 'now' : '';
      });
      const assigned = [found.throttle?.axis, found.x?.axis, found.y?.axis].filter((a): a is number => a !== undefined);
      active =
        next === 'throttle'
          ? watch(createThrottleDetector([]), (r) => (found.throttle = r))
          : next === 'x'
            ? watch(createStickDetector(assigned, 'negative'), (r) => (found.x = r))
            : next === 'y'
              ? watch(createStickDetector(assigned, 'positive'), (r) => (found.y = r))
              : next === 'arm'
                ? watch(createArmDetector(assigned), (r) => (found.arm = r))
                : undefined;
      placeStick(stickL, L, 0, next === 'throttle' ? -1 : 0);
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

    const nextOf: Record<Step, Step> = { connect: 'throttle', throttle: 'x', x: 'y', y: 'arm', arm: 'done', done: 'done' };

    const finish = (): void => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
      voice.stop();
      root.remove();
      resolve();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.code === 'Backspace' && step === 'done') {
        e.preventDefault();
        input.setMapping(undefined);
        found = {};
        enter('throttle', performance.now());
      }
    };
    window.addEventListener('keydown', onKey, true);

    const drawCandidate = (c: AxisCandidate | undefined, sec: number): void => {
      const d = demo(sec);
      root.querySelectorAll('.sw-arrow.on').forEach((el) => el.classList.remove('on'));
      const lit = (cls: string): void => root.querySelectorAll(cls).forEach((el) => el.classList.add('on'));
      if (step === 'throttle') {
        lit(d.first ? '.sw-a-l1' : '.sw-a-l2');
        placeStick(stickL, L, 0, c ? c.display : d.value);
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

    const loop = (now: number): void => {
      frame = requestAnimationFrame(loop);
      input.poll();
      if (tickUntil !== undefined) {
        if (now < tickUntil) return;
        tickUntil = undefined;
        root.classList.remove('sw-ticked');
        enter(nextOf[step], now);
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
        if (active.push(raw, now)) complete(now);
      }
      if (step === 'done') {
        const s = input.state;
        throttleFill.style.height = `${s.throttle * 100}%`;
        padDot.style.left = `${50 + s.stickX * 42}%`;
        padDot.style.top = `${50 - s.stickY * 42}%`;
        lamp.classList.toggle('on', s.armed);
        if (awaitingConfirm && input.confirm) finish();
        return;
      }
      if (tickUntil === undefined) drawCandidate(active?.candidate, (now - stepStart) / 1000);
    };

    input.poll();
    const start = performance.now();
    enter(input.raw ? 'throttle' : 'connect', start);
    frame = requestAnimationFrame(loop);
  });
}
