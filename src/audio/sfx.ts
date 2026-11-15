import type { Sfx } from '../types.ts';

const SILENCE = 0.0001;
const STOP_FADE = 0.06;
const STAR_STEPS = [0, 2, 4, 7, 9, 12];
const STAR_RESET_SECONDS = 1.2;

/** A gain node every sound of one generation plays through, so `stop` can fade them together. */
interface Sink {
  readonly gain: GainNode;
  readonly sources: Set<AudioScheduledSourceNode>;
}

interface Engine {
  readonly out: GainNode;
  readonly lowpass: BiquadFilterNode;
  readonly sub: OscillatorNode;
  readonly sources: AudioScheduledSourceNode[];
  level: number;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, brown: boolean): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = brown ? (last + 0.02 * white) / 1.02 : white;
    data[i] = last;
    peak = Math.max(peak, Math.abs(last));
  }
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) / peak;
  return buffer;
}

/** Sparse random clicks whose density falls to zero over the buffer. */
function crackleBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const fade = 1 - i / data.length;
    if (Math.random() < 0.005 * fade) data[i] = (Math.random() * 2 - 1) * fade;
  }
  return buffer;
}

/** Synthesized effects on `ctx`, played into `out`. */
export function createSfx(ctx: BaseAudioContext, out: AudioNode): Sfx {
  const brown = noiseBuffer(ctx, 4, true);
  const white = noiseBuffer(ctx, 2, false);
  const crackle = crackleBuffer(ctx, 2);
  let sink = makeSink();
  let engine: Engine | undefined;
  let engineTimer: ReturnType<typeof setTimeout> | undefined;
  let starCount = 0;
  let lastStarAt = -Infinity;

  function makeSink(): Sink {
    const gain = ctx.createGain();
    gain.connect(out);
    return { gain, sources: new Set() };
  }

  /** Starts `src` at `at`, stops it at `end`, and disconnects `chain` once it has ended. */
  function run(src: AudioScheduledSourceNode, at: number, end: number, chain: AudioNode[]): void {
    const owner = sink;
    owner.sources.add(src);
    src.onended = () => {
      owner.sources.delete(src);
      src.disconnect();
      for (const node of chain) node.disconnect();
    };
    src.start(at);
    src.stop(end);
  }

  function envelope(param: AudioParam, at: number, peak: number, attack: number, decay: number, floor = SILENCE): void {
    param.setValueAtTime(SILENCE, at);
    param.linearRampToValueAtTime(peak, at + attack);
    param.exponentialRampToValueAtTime(floor, at + attack + decay);
  }

  /** One oscillator note: pitch glides from `f0` to `f1` over `dur` while the level attacks to `peak` and decays. */
  function tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number, attack = 0.004): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
    envelope(gain.gain, at, peak, attack, dur - attack);
    osc.connect(gain).connect(sink.gain);
    run(osc, at, at + dur + 0.02, [gain]);
  }

  /** One filtered noise burst: the filter sweeps from `f0` to `f1` over `dur` while the level attacks to `peak` and decays. */
  function burst(buffer: AudioBuffer, filter: BiquadFilterType, f0: number, f1: number, q: number, at: number, dur: number, peak: number, floor = SILENCE): void {
    const src = ctx.createBufferSource();
    const biquad = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = buffer;
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(f0, at);
    biquad.frequency.exponentialRampToValueAtTime(f1, at + dur);
    envelope(gain.gain, at, peak, 0.004, dur - 0.004, floor);
    src.connect(biquad).connect(gain).connect(sink.gain);
    run(src, at, at + dur + 0.02, [biquad, gain]);
  }

  function startEngine(): Engine {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(sink.gain);

    const rumble = ctx.createBufferSource();
    rumble.buffer = brown;
    rumble.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0.7;
    const flutter = ctx.createGain();
    flutter.gain.value = 0.85;
    rumble.connect(lowpass).connect(flutter).connect(out);

    const wobble = ctx.createBufferSource();
    wobble.buffer = brown;
    wobble.loop = true;
    const wobbleLowpass = ctx.createBiquadFilter();
    wobbleLowpass.type = 'lowpass';
    wobbleLowpass.frequency.value = 4;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.6;
    wobble.connect(wobbleLowpass).connect(wobbleDepth).connect(flutter.gain);

    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    const subLowpass = ctx.createBiquadFilter();
    subLowpass.type = 'lowpass';
    subLowpass.frequency.value = 180;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    sub.connect(subLowpass).connect(subGain).connect(out);

    const sources = [rumble, wobble, sub];
    for (const src of sources) {
      sink.sources.add(src);
      src.start();
    }
    return { out, lowpass, sub, sources, level: 0 };
  }

  function disposeEngine(e: Engine): void {
    for (const src of e.sources) {
      sink.sources.delete(src);
      src.stop();
      src.disconnect();
    }
    e.out.disconnect();
  }

  return {
    setEngine(level) {
      const l = Math.min(1, Math.max(0, level));
      clearTimeout(engineTimer);
      if (!engine) {
        if (l === 0) return;
        engine = startEngine();
      }
      const e = engine;
      e.level = l;
      const now = ctx.currentTime;
      e.out.gain.setTargetAtTime(0.7 * l ** 1.3, now, 0.05);
      e.lowpass.frequency.setTargetAtTime(130 + 1300 * l, now, 0.05);
      e.sub.frequency.setTargetAtTime(36 + 22 * l, now, 0.05);
      if (l === 0) {
        engineTimer = setTimeout(() => {
          if (engine === e && e.level === 0) {
            disposeEngine(e);
            engine = undefined;
          }
        }, 400);
      }
    },

    explosion() {
      const t = ctx.currentTime;
      tone('sine', 110, 28, t, 1.1, 1, 0.005);
      tone('triangle', 220, 50, t, 0.5, 0.25, 0.005);
      burst(brown, 'lowpass', 5000, 150, 0.7, t, 1.6, 1.4);
      burst(white, 'lowpass', 7000, 300, 0.7, t, 0.5, 0.25);
      burst(crackle, 'bandpass', 1800, 1800, 0.6, t + 0.15, 2, 3, 1);
    },

    tick() {
      const t = ctx.currentTime;
      tone('sine', 1000, 1000, t, 0.09, 1, 0.002);
      tone('sine', 2000, 2000, t, 0.05, 0.25, 0.002);
    },

    clank() {
      const t = ctx.currentTime;
      tone('sine', 120, 55, t, 0.3, 1, 0.002);
      for (const [f, peak, dur] of [[340, 0.4, 0.45], [523, 0.35, 0.38], [871, 0.28, 0.3], [1290, 0.18, 0.22], [1830, 0.12, 0.16]] as const) {
        tone('sine', f, f, t, dur, peak, 0.002);
      }
      burst(white, 'bandpass', 3000, 3000, 1.2, t, 0.06, 0.35);
    },

    fail() {
      const t = ctx.currentTime;
      for (const [i, f] of [392, 330, 262].entries()) {
        const at = t + i * 0.26;
        tone('triangle', f, f * 0.94, at, i === 2 ? 0.6 : 0.3, 0.32, 0.02);
        tone('sine', f / 2, (f / 2) * 0.94, at, i === 2 ? 0.6 : 0.3, 0.2, 0.02);
      }
    },

    success() {
      const t = ctx.currentTime;
      for (const [i, f] of [523, 659, 784, 1047].entries()) {
        const at = t + i * 0.13;
        const dur = i === 3 ? 0.65 : 0.3;
        tone('triangle', f, f, at, dur, 0.35, 0.01);
        tone('square', f, f, at, dur, 0.06, 0.01);
        tone('sine', f * 2, f * 2, at, dur, 0.1, 0.01);
      }
    },

    star() {
      const t = ctx.currentTime;
      starCount = t - lastStarAt > STAR_RESET_SECONDS ? 0 : Math.min(starCount + 1, STAR_STEPS.length - 1);
      lastStarAt = t;
      const f = 1047 * 2 ** ((STAR_STEPS[starCount] ?? 0) / 12);
      tone('sine', f, f, t, 0.7, 0.7, 0.002);
      tone('sine', f * 2, f * 2, t, 0.4, 0.25, 0.002);
      tone('sine', f * 3.01, f * 3.01, t, 0.22, 0.1, 0.002);
    },

    stop() {
      clearTimeout(engineTimer);
      engine = undefined;
      const old = sink;
      sink = makeSink();
      const now = ctx.currentTime;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + STOP_FADE);
      setTimeout(() => {
        for (const src of old.sources) src.stop();
        old.gain.disconnect();
      }, STOP_FADE * 1000 + 40);
    },
  };
}
