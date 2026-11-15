import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMapping,
  createArmDetector,
  createStickDetector,
  createThrottleBottomDetector,
  createThrottleTopDetector,
  loadMapping,
  saveMapping,
  type Detector,
  type Mapping,
  type RawSnapshot,
} from './mapping.ts';

const FRAME = 1000 / 60;

/** Builds a 60 Hz stream of raw snapshots from moves and holds, with optional deterministic noise on chosen axes. */
class Script {
  readonly frames: { raw: RawSnapshot; t: number }[] = [];
  private axes: number[];
  private buttons: boolean[];
  private t = 0;
  private seed = 1;
  private noise = new Map<number, number>();
  /** Axes that report 0 until their value first changes, with the value they started at. */
  private stale = new Map<number, number>();

  constructor(axes: number[], buttons = 0) {
    this.axes = [...axes];
    this.buttons = Array.from({ length: buttons }, () => false);
  }

  /** Adds ± `amplitude` jitter to `axis` on every frame from now on. */
  jitter(axis: number, amplitude: number): this {
    this.noise.set(axis, amplitude);
    return this;
  }

  /** Makes the given axes report 0 until their value first changes from what it is now, as Chrome on Android does. */
  staleUntilMoved(...axes: number[]): this {
    for (const a of axes) this.stale.set(a, this.axes[a] ?? 0);
    return this;
  }

  /** Moves the given axes linearly to their targets over `ms`. */
  move(targets: Record<number, number>, ms: number): this {
    const from = [...this.axes];
    const n = Math.max(1, Math.round(ms / FRAME));
    for (let k = 1; k <= n; k++) {
      for (const [i, to] of Object.entries(targets)) {
        const a = Number(i);
        this.axes[a] = (from[a] ?? 0) + ((to - (from[a] ?? 0)) * k) / n;
      }
      this.emit();
    }
    return this;
  }

  /** Sets axes or buttons instantly, as a switch does. */
  set(axes: Record<number, number>, buttons: Record<number, boolean> = {}): this {
    for (const [i, v] of Object.entries(axes)) this.axes[Number(i)] = v;
    for (const [i, v] of Object.entries(buttons)) this.buttons[Number(i)] = v;
    this.emit();
    return this;
  }

  hold(ms: number): this {
    const n = Math.max(1, Math.round(ms / FRAME));
    for (let k = 0; k < n; k++) this.emit();
    return this;
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
    return this.seed / 2147483648;
  }

  private emit(): void {
    const axes = this.axes.map((v, i) => v + (this.noise.has(i) ? (this.rand() * 2 - 1) * (this.noise.get(i) ?? 0) : 0));
    for (const [a, v0] of this.stale) {
      if (axes[a] === v0) axes[a] = 0;
      else this.stale.delete(a);
    }
    this.frames.push({ raw: { id: 'TX12 Joystick', axes, buttons: [...this.buttons] }, t: this.t });
    this.t += FRAME;
  }
}

/** Feeds the stream and returns the result with the frame index it completed at. */
function run<T>(det: Detector<T>, script: Script): { result: T | undefined; at: number } {
  for (let i = 0; i < script.frames.length; i++) {
    const f = script.frames[i];
    if (!f) break;
    const r = det.push(f.raw, f.t);
    if (r !== undefined) return { result: r, at: i };
  }
  return { result: undefined, at: -1 };
}

// Channel orders as 8 HID axes: sticks on CH1–4, switches SA–SD mixed to CH5–8.
// AETR: aileron (right X) 0, elevator (right Y) 1, throttle 2, rudder 3. TAER: throttle 0, aileron 1, elevator 2, rudder 3.
const AETR = { x: 0, y: 1, throttle: 2 };
const TAER = { throttle: 0, x: 1, y: 2 };
const rest = (throttleAxis: number): number[] => [0, 0, 0, 0, -1, -1, -1, -1].map((v, i) => (i === throttleAxis ? -1 : v));

/** Runs the throttle's top step until it completes, then the bottom step on the frames after it. */
function detectThrottle(script: Script, exclude: number[] = []): { axis: number; top: number; bottom: number } | undefined {
  const top = run(createThrottleTopDetector(exclude), script);
  if (!top.result) return undefined;
  const { axis, top: topValue } = top.result;
  const rest = new Script([]);
  rest.frames.push(...script.frames.slice(top.at + 1));
  const bottom = run(createThrottleBottomDetector(axis, topValue), rest).result;
  return bottom === undefined ? undefined : { axis, top: topValue, bottom };
}

/** Up, hold at the top, down, hold at the bottom: what the two throttle prompts ask for. */
const upDown = (s: Script, axis: number, top: number, bottom: number, pause = 600): Script =>
  s.move({ [axis]: top }, 500).hold(pause).move({ [axis]: bottom }, 500).hold(600);

describe('throttle detector', () => {
  it('finds the throttle in AETR order', () => {
    const s = upDown(new Script(rest(AETR.throttle)).hold(200), AETR.throttle, 1, -1);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('finds the throttle in TAER order', () => {
    const s = upDown(new Script(rest(TAER.throttle)).hold(200), TAER.throttle, 1, -1);
    expect(detectThrottle(s)).toEqual({ axis: 0, top: 1, bottom: -1 });
  });

  it('records an inverted throttle', () => {
    const s = upDown(new Script([0, 0, 1, 0]).hold(200), 2, -1, 1);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: -1, bottom: 1 });
  });

  it('records reduced endpoints', () => {
    const r = detectThrottle(upDown(new Script([0, 0, -0.8, 0]).hold(200), 2, 0.8, -0.8));
    expect(r?.axis).toBe(2);
    expect(r?.top).toBeCloseTo(0.8);
    expect(r?.bottom).toBeCloseTo(-0.8);
  });

  it('starts from the middle', () => {
    expect(detectThrottle(upDown(new Script([0, 0, 0, 0]), 2, 1, -1))).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('starts at the top: moved down and straight back up, then down', () => {
    const s = new Script([0, 0, 1, 0]).hold(500).move({ 2: -1 }, 500).move({ 2: 1 }, 500).hold(600).move({ 2: -1 }, 500).hold(600);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('a long pause at the top never ends the step', () => {
    const det = createThrottleTopDetector([]);
    const s = new Script(rest(2)).move({ 2: 1 }, 500).hold(8000);
    const top = run(det, s);
    expect(top.result).toEqual({ axis: 2, top: 1 });
    const bottom = createThrottleBottomDetector(2, 1);
    const rest2 = new Script([]);
    rest2.frames.push(...s.frames.slice(top.at + 1));
    expect(run(bottom, rest2).result).toBeUndefined();
  });

  it('the top needs a steady hold of 0.4 s', () => {
    const s = new Script(rest(2)).move({ 2: 1 }, 500);
    const arrived = s.frames.length;
    s.hold(800);
    const { at } = run(createThrottleTopDetector([]), s);
    expect((at - arrived + 1) * FRAME).toBeGreaterThanOrEqual(400);
    expect((at - arrived) * FRAME).toBeLessThan(450);
  });

  it('the bottom must be at least MIN_RANGE from the top', () => {
    const s = new Script(rest(2)).move({ 2: 1 }, 500).hold(600).move({ 2: 0 }, 300).hold(1500);
    expect(detectThrottle(s)).toBeUndefined();
  });

  it('Android: an axis reading 0 until it moves, at the bottom', () => {
    const s = upDown(new Script(rest(2)).staleUntilMoved(0, 1, 2, 3, 4, 5, 6, 7).hold(500), 2, 1, -1);
    expect(s.frames[0]?.raw.axes[2]).toBe(0);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('Android: an inverted throttle reading 0 until it moves, with a long pause at the top', () => {
    const s = upDown(new Script([0, 0, 1, 0, -1]).staleUntilMoved(0, 1, 2, 3, 4).hold(500), 2, -1, 1, 4000);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: -1, bottom: 1 });
  });

  it('Android: starting in the middle and at the top', () => {
    expect(detectThrottle(upDown(new Script([0, 0, 0.1, 0]).staleUntilMoved(2), 2, 1, -1))).toEqual({ axis: 2, top: 1, bottom: -1 });
    const s = new Script([0, 0, 1, 0]).staleUntilMoved(2).hold(300).move({ 2: -1 }, 500).move({ 2: 1 }, 500).hold(600).move({ 2: -1 }, 500).hold(600);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('Android: a second stale axis jumping during the step is not travel', () => {
    const s = new Script(rest(2)).staleUntilMoved(2, 5, 6).hold(300).move({ 2: 1 }, 500);
    s.set({ 5: -0.98 }).set({ 6: 1 }).hold(600).move({ 2: -1 }, 500).hold(600);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('ignores a noisy unrelated axis', () => {
    const s = upDown(new Script(rest(2)).jitter(5, 0.12).jitter(3, 0.1).hold(300), 2, 1, -1);
    expect(detectThrottle(s)).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('noise alone never makes a candidate', () => {
    const s = new Script(rest(2)).jitter(0, 0.14).jitter(5, 0.14).hold(3000);
    const det = createThrottleTopDetector([]);
    run(det, s);
    expect(det.candidate).toBeUndefined();
  });

  it('prefers the throttle over a slight wiggle of the wrong stick', () => {
    const s = new Script(rest(2)).move({ 0: 0.25 }, 150).move({ 0: -0.25 }, 300).move({ 0: 0 }, 150).move({ 1: 0.5 }, 150).move({ 1: 0 }, 150);
    expect(detectThrottle(upDown(s, 2, 1, -1))).toEqual({ axis: 2, top: 1, bottom: -1 });
  });

  it('shows the candidate rising as it travels up and falling as it travels down', () => {
    const det = createThrottleTopDetector([]);
    run(det, new Script(rest(2)).move({ 2: 0 }, 300));
    expect(det.candidate?.axis).toBe(2);
    expect(det.candidate?.display).toBeGreaterThan(-0.2);
    const down = createThrottleBottomDetector(2, 1);
    run(down, new Script(rest(2)).set({ 2: 0.5 }));
    expect(down.candidate?.display).toBeCloseTo(0.5);
  });
});

describe('stick detector', () => {
  const xLeftRight = (axes: number[], axis: number, left: number, right: number) =>
    new Script(axes).hold(100).move({ [axis]: left }, 300).move({ [axis]: right }, 500).move({ [axis]: axes[axis] ?? 0 }, 300).hold(400);

  it('finds right X in AETR order, skipping the throttle', () => {
    const s = xLeftRight(rest(AETR.throttle), AETR.x, -1, 1);
    expect(run(createStickDetector([AETR.throttle], 'negative'), s).result).toEqual({ axis: 0, rest: 0, negative: -1, positive: 1 });
  });

  it('finds right X in TAER order', () => {
    const s = xLeftRight(rest(TAER.throttle), TAER.x, -1, 1);
    expect(run(createStickDetector([TAER.throttle], 'negative'), s).result).toEqual({ axis: 1, rest: 0, negative: -1, positive: 1 });
  });

  it('records an inverted right Y with reduced endpoints', () => {
    // up first: the axis reads +0.8 at the bottom and -0.8 at the top
    const s = xLeftRight(rest(TAER.throttle), TAER.y, -0.8, 0.8);
    const r = run(createStickDetector([TAER.throttle, TAER.x], 'positive'), s).result;
    expect(r?.axis).toBe(2);
    expect(r?.positive).toBeCloseTo(-0.8);
    expect(r?.negative).toBeCloseTo(0.8);
  });

  it('ignores an assigned axis even when it moves most', () => {
    const s = new Script(rest(AETR.throttle)).move({ 2: 1 }, 300).move({ 2: -1 }, 300).move({ 0: -1 }, 300).move({ 0: 1 }, 400).move({ 0: 0 }, 300).hold(400);
    expect(run(createStickDetector([AETR.throttle], 'negative'), s).result?.axis).toBe(0);
  });

  it('does not complete until back at rest for 0.3 s', () => {
    const s = new Script([0, 0, -1, 0]).move({ 0: -1 }, 300).move({ 0: 1 }, 500).hold(1000);
    expect(run(createStickDetector([2], 'negative'), s).result).toBeUndefined();
  });

  it('does not complete after one side only', () => {
    const s = new Script([0, 0, -1, 0]).move({ 0: -1 }, 300).move({ 0: 0 }, 300).hold(1000);
    expect(run(createStickDetector([2], 'negative'), s).result).toBeUndefined();
  });

  it('wiggling the wrong stick slightly first still finds the right one', () => {
    const s = new Script(rest(AETR.throttle)).move({ 1: 0.2 }, 100).move({ 1: -0.2 }, 200).move({ 1: 0 }, 100).move({ 3: 0.6 }, 200).move({ 3: 0 }, 200);
    s.move({ 0: -1 }, 300).move({ 0: 1 }, 500).move({ 0: 0 }, 300).hold(400);
    expect(run(createStickDetector([AETR.throttle], 'negative'), s).result?.axis).toBe(0);
  });

  it('Android: a stale stick with an off-centre rest takes its rest from where it settles', () => {
    const s = new Script([0.06, 0, -1, 0, -1]).staleUntilMoved(0, 1, 2, 3, 4).hold(300);
    s.move({ 0: -1 }, 300).move({ 0: 1 }, 500).move({ 0: 0.06 }, 300).hold(400);
    expect(s.frames[0]?.raw.axes[0]).toBe(0);
    const r = run(createStickDetector([2], 'negative'), s).result;
    expect(r?.axis).toBe(0);
    expect(r?.rest).toBeCloseTo(0.06);
    expect(r?.negative).toBe(-1);
    expect(r?.positive).toBe(1);
  });

  it('a pause at an end does not complete', () => {
    const s = new Script([0, 0, -1, 0]).move({ 0: -1 }, 300).move({ 0: 1 }, 500).hold(800).move({ 0: -1 }, 600).hold(800);
    expect(run(createStickDetector([2], 'negative'), s).result).toBeUndefined();
  });

  it('ignores a noisy unrelated axis', () => {
    const s = new Script(rest(AETR.throttle)).jitter(4, 0.12).jitter(1, 0.08).move({ 0: -1 }, 300).move({ 0: 1 }, 500).move({ 0: 0 }, 300).hold(400);
    const r = run(createStickDetector([AETR.throttle], 'negative'), s).result;
    expect(r?.axis).toBe(0);
  });
});

describe('arm detector', () => {
  const assigned = [AETR.x, AETR.y, AETR.throttle];

  it('finds a two-position switch on an axis', () => {
    const s = new Script(rest(AETR.throttle)).hold(300).set({ 4: 1 }).hold(400);
    expect(run(createArmDetector(assigned), s).result).toEqual({ kind: 'axis', axis: 4, armed: 1 });
  });

  it('finds a three-position switch flipped to the far end, and the middle is not armed', () => {
    const s = new Script(rest(AETR.throttle)).hold(300).set({ 5: 0 }).set({ 5: 1 }).hold(400);
    const r = run(createArmDetector(assigned), s).result;
    expect(r).toEqual({ kind: 'axis', axis: 5, armed: 1 });
    const m = mapping({ arm: r ?? { kind: 'axis', axis: 5, armed: 1 } });
    const at = (v: number) => applyMapping(m, { id: '', axes: [0, 0, -1, 0, -1, v], buttons: [] }).armed;
    expect([at(-1), at(0), at(1)]).toEqual([false, false, true]);
  });

  it('a three-position switch flipped to the middle arms only the middle', () => {
    const s = new Script(rest(AETR.throttle)).hold(300).set({ 6: 0 }).hold(400);
    const r = run(createArmDetector(assigned), s).result;
    expect(r).toEqual({ kind: 'axis', axis: 6, armed: 0 });
  });

  it('a switch that passes the middle on the way does not stop at the middle', () => {
    const s = new Script(rest(AETR.throttle)).hold(300).set({ 5: 0 }).hold(100).set({ 5: 1 }).hold(400);
    expect(run(createArmDetector(assigned), s).result).toEqual({ kind: 'axis', axis: 5, armed: 1 });
  });

  it('finds the switch as a button, pressed means armed', () => {
    const s = new Script(rest(AETR.throttle), 8).hold(300).set({}, { 3: true }).hold(400);
    expect(run(createArmDetector(assigned), s).result).toEqual({ kind: 'button', button: 3, pressed: true });
  });

  it('finds the switch as a button, released means armed', () => {
    const s = new Script(rest(AETR.throttle), 8).set({}, { 2: true }).hold(300).set({}, { 2: false }).hold(400);
    expect(run(createArmDetector(assigned), s).result).toEqual({ kind: 'button', button: 2, pressed: false });
  });

  it('ignores a button tap shorter than 0.25 s', () => {
    const s = new Script(rest(AETR.throttle), 4).hold(200).set({}, { 1: true }).hold(150).set({}, { 1: false }).hold(600);
    expect(run(createArmDetector(assigned), s).result).toBeUndefined();
  });

  it('Android: a stale switch axis jumping from 0 when first flipped is the flip', () => {
    const up = new Script(rest(AETR.throttle)).staleUntilMoved(4, 5, 6, 7).hold(300).set({ 5: 1 }).hold(400);
    expect(up.frames[0]?.raw.axes[5]).toBe(0);
    expect(run(createArmDetector(assigned), up).result).toEqual({ kind: 'axis', axis: 5, armed: 1 });
    const down = new Script([0, 0, -1, 0, 1, 1]).staleUntilMoved(4, 5).hold(300).set({ 4: -1 }).hold(400);
    expect(run(createArmDetector(assigned), down).result).toEqual({ kind: 'axis', axis: 4, armed: -1 });
  });

  it('Android: a stale stick axis reporting its real position near 0 is not a flip', () => {
    const s = new Script([0, 0, -1, 0.02, -1]).staleUntilMoved(3, 4).hold(300).move({ 3: 0.05 }, 200).hold(600);
    expect(run(createArmDetector(assigned), s).result).toBeUndefined();
  });

  it('ignores assigned axes and noise', () => {
    const s = new Script(rest(AETR.throttle)).jitter(7, 0.2).move({ 2: 1 }, 200).hold(400).move({ 0: 1 }, 100).hold(400).set({ 6: 1 }).hold(400);
    expect(run(createArmDetector(assigned), s).result).toEqual({ kind: 'axis', axis: 6, armed: 1 });
  });
});

function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    padId: 'TX12 Joystick',
    throttle: { axis: 2, bottom: -1, top: 1 },
    stickX: { axis: 0, rest: 0, negative: -1, positive: 1 },
    stickY: { axis: 1, rest: 0, negative: -1, positive: 1 },
    arm: { kind: 'axis', axis: 4, armed: 1 },
    ...over,
  };
}

const raw = (axes: number[], buttons: boolean[] = []): RawSnapshot => ({ id: 'TX12 Joystick', axes, buttons });

describe('applyMapping', () => {
  it('maps the throttle to 0…1 and clamps it', () => {
    const m = mapping();
    expect(applyMapping(m, raw([0, 0, -1, 0, -1])).throttle).toBe(0);
    expect(applyMapping(m, raw([0, 0, 0, 0, -1])).throttle).toBeCloseTo(0.5);
    expect(applyMapping(m, raw([0, 0, 1, 0, -1])).throttle).toBe(1);
    expect(applyMapping(m, raw([0, 0, 1.2, 0, -1])).throttle).toBe(1);
    expect(applyMapping(m, raw([0, 0, -1.2, 0, -1])).throttle).toBe(0);
  });

  it('handles an inverted throttle with reduced endpoints', () => {
    const m = mapping({ throttle: { axis: 2, bottom: 0.8, top: -0.8 } });
    expect(applyMapping(m, raw([0, 0, 0.8])).throttle).toBe(0);
    expect(applyMapping(m, raw([0, 0, -0.8])).throttle).toBe(1);
    expect(applyMapping(m, raw([0, 0, 0])).throttle).toBeCloseTo(0.5);
  });

  it('maps the stick to −1…+1 with a 5 % dead zone and clamping', () => {
    const m = mapping();
    const x = (v: number) => applyMapping(m, raw([v, 0, -1])).stickX;
    expect(x(0)).toBe(0);
    expect(x(0.049)).toBe(0);
    expect(x(-0.049)).toBe(0);
    expect(x(0.06)).toBeGreaterThan(0);
    expect(x(0.06)).toBeLessThan(0.02);
    expect(x(0.525)).toBeCloseTo(0.5);
    expect(x(1)).toBe(1);
    expect(x(-1)).toBe(-1);
    expect(x(1.3)).toBe(1);
    expect(x(-1.3)).toBe(-1);
  });

  it('maps each side of an off-centre, inverted stick piecewise', () => {
    const m = mapping({ stickY: { axis: 1, rest: 0.1, negative: 0.9, positive: -0.7 } });
    const y = (v: number) => applyMapping(m, raw([0, v, -1])).stickY;
    expect(y(0.1)).toBe(0);
    expect(y(-0.7)).toBe(1);
    expect(y(0.9)).toBe(-1);
    expect(y(-0.3)).toBeCloseTo((0.5 - 0.05) / 0.95);
    expect(y(0.5)).toBeCloseTo(-(0.5 - 0.05) / 0.95);
  });

  it('reads the arm switch from an axis or a button', () => {
    expect(applyMapping(mapping(), raw([0, 0, -1, 0, 1])).armed).toBe(true);
    expect(applyMapping(mapping(), raw([0, 0, -1, 0, 0.7])).armed).toBe(true);
    expect(applyMapping(mapping(), raw([0, 0, -1, 0, -1])).armed).toBe(false);
    expect(applyMapping(mapping(), raw([0, 0, -1, 0])).armed).toBe(false);
    const released = mapping({ arm: { kind: 'button', button: 1, pressed: false } });
    expect(applyMapping(released, raw([0, 0, -1], [false, false])).armed).toBe(true);
    expect(applyMapping(released, raw([0, 0, -1], [false, true])).armed).toBe(false);
  });
});

describe('storage', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
  });

  it('round-trips a mapping', () => {
    const m = mapping({ arm: { kind: 'button', button: 7, pressed: false } });
    saveMapping(m);
    expect(loadMapping()).toEqual(m);
    saveMapping(undefined);
    expect(loadMapping()).toBeUndefined();
  });

  it('treats a malformed stored value as absent', () => {
    for (const bad of ['{not json', '42', 'null', '{"padId":"x"}', JSON.stringify({ ...mapping(), throttle: { axis: -1, bottom: 0, top: 1 } }),
      JSON.stringify({ ...mapping(), stickX: { axis: 0, rest: 0, negative: 0, positive: 1 } }), JSON.stringify({ ...mapping(), arm: { kind: 'switch', axis: 4 } })]) {
      store.set('starfury.mapping', bad);
      expect(loadMapping()).toBeUndefined();
    }
  });
});
