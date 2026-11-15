import { createAudioGraph } from '../src/audio/index.ts';
import lines from '../src/audio/lines.json';
import type { LineId } from '../src/types.ts';

const EFFECTS = ['explosion', 'tick', 'clank', 'fail', 'success', 'star', 'stop'] as const;
type Effect = (typeof EFFECTS)[number];

const ctx = new AudioContext();
const graph = createAudioGraph(ctx);
const { audio } = graph;
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
graph.output.connect(analyser);

const samples = new Float32Array(analyser.fftSize);
let rms = 0;
let peak = 0;
function sample(): void {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  let framePeak = 0;
  for (const v of samples) {
    sum += v * v;
    framePeak = Math.max(framePeak, Math.abs(v));
  }
  rms = Math.sqrt(sum / samples.length);
  peak = Math.max(peak, framePeak);
  document.getElementById('meter')!.textContent = `rms ${rms.toFixed(3)}  peak ${peak.toFixed(3)}`;
  requestAnimationFrame(sample);
}
requestAnimationFrame(sample);

/** Renders one effect on a fresh offline graph; returns its audible length and peak. */
async function offline(effect: Exclude<Effect, 'stop'>, seconds = 4): Promise<{ duration: number; peak: number; rms: number }> {
  const rate = 48000;
  const offlineCtx = new OfflineAudioContext(1, rate * seconds, rate);
  createAudioGraph(offlineCtx).audio.sfx[effect]();
  const data = (await offlineCtx.startRendering()).getChannelData(0);
  let last = 0;
  let max = 0;
  let sum = 0;
  for (const [i, v] of data.entries()) {
    max = Math.max(max, Math.abs(v));
    sum += v * v;
    if (Math.abs(v) > 0.001) last = i;
  }
  return { duration: last / rate, peak: max, rms: Math.sqrt(sum / data.length) };
}

/** A WAV file of a sine tone, as the body of a fake voice-line response. */
function toneWav(freq: number, seconds: number): Response {
  const rate = 24000;
  const n = Math.floor(rate * seconds);
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at: number, s: string): void => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 0.5 * 32767, true);
  return new Response(view.buffer, { headers: { 'Content-Type': 'audio/wav' } });
}

// `?tones` answers the first two lines' requests with test tones (0.8 s and 0.5 s) instead of the MP3s.
if (new URLSearchParams(location.search).has('tones')) {
  const [a, b] = Object.keys(lines);
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(input);
    if (url.endsWith(`/${a}.mp3`)) return Promise.resolve(toneWav(440, 0.8));
    if (url.endsWith(`/${b}.mp3`)) return Promise.resolve(toneWav(660, 0.5));
    return realFetch(input, init);
  };
}

Object.assign(window, {
  dev: {
    ctx,
    audio,
    read: () => ({ rms, peak }),
    reset: () => {
      peak = 0;
    },
    offline,
    effects: EFFECTS,
  },
});

const unlock = (): Promise<void> => audio.unlock();
document.getElementById('unlock')!.addEventListener('click', unlock);
document.addEventListener('pointerdown', unlock);

const effects = document.getElementById('effects')!;
for (const name of EFFECTS) {
  const button = document.createElement('button');
  button.textContent = name;
  button.addEventListener('click', () => audio.sfx[name]());
  effects.append(button);
}

const slider = document.getElementById('engine') as HTMLInputElement;
slider.addEventListener('input', () => {
  audio.sfx.setEngine(Number(slider.value));
  document.getElementById('engineValue')!.textContent = Number(slider.value).toFixed(2);
});

document.getElementById('stopVoice')!.addEventListener('click', () => audio.voice.stop());
const lineList = document.getElementById('lines')!;
for (const [id, line] of Object.entries(lines)) {
  const wrap = document.createElement('span');
  wrap.className = 'line';
  wrap.title = line.text;
  for (const mode of ['say', 'queue'] as const) {
    const button = document.createElement('button');
    button.textContent = `${mode} ${id}`;
    button.addEventListener('click', () => void audio.voice[mode](id as LineId));
    wrap.append(button);
  }
  lineList.append(wrap);
}

void audio.voice.load();
