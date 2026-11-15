import type { LineId, Voice } from '../src/types.ts';
import lines from '../src/audio/lines.json';
import { createInput } from '../src/input/index.ts';
import { runSetupWizard } from '../src/ui/setupWizard.ts';

// Raw view of the controller plus the mapped input. `?fake` replaces the Gamepad API with a scripted TX12 that performs
// each wizard step by itself (TAER order, inverted reduced-endpoint throttle, inverted elevator, SA on axis 4);
// `?fake=android` makes its axes read 0 until they first move; `?wizard` starts the wizard on load.

const params = new URLSearchParams(location.search);
if (params.has('fake')) installFakePad();

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = createInput();
const caption = el('caption');

/** A voice that shows the line as a caption and ends after `?voiceMs` milliseconds (default 1500). */
const voice: Voice = (() => {
  let end: (() => void) | undefined;
  const say = (id: LineId): Promise<void> => {
    end?.();
    caption.textContent = `voice: ${lines[id].de}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(), Number(params.get('voiceMs') ?? 1500));
      const done = (): void => {
        clearTimeout(timer);
        if (end === done) end = undefined;
        resolve();
      };
      end = done;
    });
  };
  return {
    load: () => Promise.resolve(),
    say,
    queue: say,
    stop: () => {
      end?.();
      caption.textContent = '';
    },
    get speaking() {
      return end !== undefined;
    },
  };
})();

let wizardRunning = false;
const startWizard = (): void => {
  if (wizardRunning) return;
  wizardRunning = true;
  void runSetupWizard(el('overlay'), voice, input).then(() => {
    wizardRunning = false;
    caption.textContent = '';
  });
};
el('wizard').addEventListener('click', (e) => {
  e.stopPropagation();
  startWizard();
});
el('clear').addEventListener('click', () => input.setMapping(undefined));
if (params.has('wizard')) startWizard();

const fmt = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(3);
const bar = (v: number): string => {
  const x = Math.max(-1, Math.min(1, v));
  return `<div class="bar"><div class="fill" style="left:${50 + Math.min(0, x) * 50}%;width:${Math.abs(x) * 50}%"></div></div>`;
};
const unitBar = (v: number): string => `<div class="bar"><div class="fill unit" style="width:${v * 100}%"></div></div>`;

const render = (): void => {
  requestAnimationFrame(render);
  if (!wizardRunning) input.poll();
  const raw = input.raw;
  el('pad-id').textContent = raw ? raw.id : 'No controller. Chrome lists it only after a stick or switch moves.';
  el('pad-id').className = raw ? '' : 'muted';
  el('axes').innerHTML = raw ? raw.axes.map((v, i) => `<div class="row"><span>axis ${i}</span>${bar(v)}<span>${fmt(v)}</span></div>`).join('') : '';
  el('buttons').innerHTML = raw ? raw.buttons.map((p, i) => `<div class="lamp${p ? ' on' : ''}">${i}</div>`).join('') : '';
  const m = input.mapping;
  const s = input.state;
  el('source').textContent = `source: ${input.source}${m ? '' : ' (no mapping stored)'}`;
  el('mapped').innerHTML = m
    ? `<div class="row"><span>throttle</span>${unitBar(s.throttle)}<span>${s.throttle.toFixed(3)}</span></div>` +
      `<div class="row"><span>stick X</span>${bar(s.stickX)}<span>${fmt(s.stickX)}</span></div>` +
      `<div class="row"><span>stick Y</span>${bar(s.stickY)}<span>${fmt(s.stickY)}</span></div>` +
      `<div class="row"><span>armed</span><div class="lamps"><div class="lamp${s.armed ? ' on' : ''}">${s.armed ? 'ON' : 'off'}</div></div><span></span></div>`
    : '';
  el('mapping').textContent = m ? JSON.stringify(m, null, 1) : '';
};
render();

/**
 * Replaces `navigator.getGamepads` with a scripted TX12 that appears after 2.5 s and acts out each wizard step `?go` seconds (default 4.5) after the step starts. With
 * `?fake=android` every axis reads 0 until its value first changes. On the confirmation step it holds still; set
 * `fakeAxes[i]` from the console to pose it.
 */
function installFakePad(): void {
  const axes = [0.8, 0, 0, 0, -1, -1, -1, -1];
  const initial = [...axes];
  const live = axes.map(() => params.get('fake') !== 'android');
  const pad = { id: 'Fake TX12 Joystick (Vendor: 1209 Product: 4f54)', index: 0, connected: true, mapping: '', timestamp: 0, axes: [...axes], buttons: [] };
  Object.assign(window, { fakeAxes: axes });
  const appearAt = performance.now() + 2500;
  const go = Number(params.get('go') ?? 4.5);
  let step: string | undefined;
  let stepStart = 0;
  const ease = (a: number, b: number, from: number, to: number, t: number): number | undefined =>
    t < from ? undefined : a + (b - a) * Math.sin(Math.min(1, (t - from) / (to - from)) * Math.PI * 0.5);
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const s = document.querySelector<HTMLElement>('.sw')?.dataset.step;
    if (s !== step) {
      step = s;
      stepStart = now;
    }
    const t = (now - stepStart) / 1000;
    const set = (i: number, v: number | undefined): void => {
      if (v !== undefined) axes[i] = v;
    };
    if (step === 'throttle_up') set(0, ease(0.8, -0.8, go, go + 0.7, t));
    else if (step === 'throttle_down') set(0, ease(-0.8, 0.8, go, go + 0.7, t));
    else if (step === 'x') {
      set(1, ease(0, -1, go, go + 0.4, t));
      set(1, ease(-1, 1, go + 0.5, go + 1.1, t));
      set(1, ease(1, 0, go + 1.2, go + 1.5, t));
    } else if (step === 'y') {
      set(2, ease(0, -1, go, go + 0.4, t));
      set(2, ease(-1, 1, go + 0.5, go + 1.1, t));
      set(2, ease(1, 0, go + 1.2, go + 1.5, t));
    } else if (step === 'arm' && t > go) axes[4] = 1;
    axes.forEach((v, i) => {
      if (v !== initial[i]) live[i] = true;
      pad.axes[i] = live[i] ? v : 0;
    });
  };
  requestAnimationFrame(tick);
  Object.defineProperty(navigator, 'getGamepads', {
    value: () => [performance.now() < appearAt ? null : (pad as unknown as Gamepad)],
  });
}
