import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instructionsFor, LANGUAGES, lineHash, PROCESSING, SPEECH } from './voice-settings.ts';
import type { VoiceLanguage } from './voice-settings.ts';

interface Line {
  tone: string;
  de: string;
  en: string;
}

const ROOT = join(import.meta.dirname, '..');
const MAX_ATTEMPTS = 4;
const ACCEPT_SIMILARITY = 0.85;
const CONCURRENCY = 4;

const key = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
if (key === undefined || key === '') throw new Error('OPENAI_KEY (or OPENAI_API_KEY) is not set');

let apiCalls = 0;

async function api(url: string, init: (headers: Record<string, string>) => RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    apiCalls += 1;
    let res: Response | undefined;
    try {
      res = await fetch(url, init({ Authorization: `Bearer ${key}` }));
    } catch (error) {
      if (attempt >= 5) throw error;
    }
    if (res !== undefined && res.status !== 429 && res.status < 500) {
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      return res;
    }
    if (attempt >= 5) throw new Error(`HTTP ${res?.status ?? 'network error'} after retries`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 500));
  }
}

async function speech(text: string, tone: string, language: VoiceLanguage): Promise<Buffer> {
  const res = await api('https://api.openai.com/v1/audio/speech', (headers) => ({
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SPEECH.model,
      voice: SPEECH.voice,
      input: text,
      instructions: instructionsFor(tone, language),
      response_format: SPEECH.responseFormat,
    }),
  }));
  return Buffer.from(await res.arrayBuffer());
}

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SPEECH.sampleRate, 24);
  header.writeUInt32LE(SPEECH.sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const TRANSCRIPTION_PROMPT: Record<VoiceLanguage, string> = { de: 'Ein kurzer Satz auf Deutsch.', en: 'A short sentence in English.' };

async function transcribe(pcm: Buffer, language: VoiceLanguage): Promise<string> {
  const res = await api('https://api.openai.com/v1/audio/transcriptions', (headers) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav(pcm))], { type: 'audio/wav' }), 'line.wav');
    form.append('model', 'gpt-4o-transcribe');
    form.append('language', language);
    form.append('prompt', TRANSCRIPTION_PROMPT[language]);
    form.append('response_format', 'text');
    return { method: 'POST', headers, body: form };
  });
  return (await res.text()).trim();
}

const ONES = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreissig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

function germanNumber(n: number): string {
  if (n === 1) return 'eins';
  if (n < 20) return ONES[n] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  return n % 10 === 0 ? tens : `${ONES[n % 10] ?? ''}und${tens}`;
}

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function englishNumber(n: number): string {
  if (n < 20) return EN_ONES[n] ?? '';
  const tens = EN_TENS[Math.floor(n / 10)] ?? '';
  return n % 10 === 0 ? tens : `${tens}${EN_ONES[n % 10] ?? ''}`;
}

function normalise(text: string, language: VoiceLanguage): string {
  const words = language === 'de' ? germanNumber : englishNumber;
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\d+/g, (d) => ` ${Number(d) < 100 ? words(Number(d)) : d} `)
    .replace(/[^a-zäöü]/g, '');
}

function similarity(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - (row[b.length] ?? 0) / Math.max(a.length, b.length, 1);
}

function ffmpeg(args: string[], input: Buffer): { stdout: Buffer; stderr: string } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { input, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  return { stdout: r.stdout, stderr: r.stderr.toString() };
}

const F32 = ['-f', 'f32le', '-ar', String(SPEECH.sampleRate), '-ac', '1'];

function activeRmsDb(f32: Buffer): number {
  const { stderr } = ffmpeg([...F32, '-i', 'pipe:0', '-af', `${PROCESSING.activeRms},astats=measure_overall=RMS_level:measure_perchannel=none`, '-f', 'null', '-'], f32);
  const matches = [...stderr.matchAll(/RMS level dB: (-?[\d.]+|-inf)/g)];
  const value = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(value)) throw new Error('no measurable speech in clip');
  return value;
}

/** PCM from the API to the final radio MP3: trim, level to the reference RMS, radio chain, level again, limit. */
function render(pcm: Buffer): Buffer {
  const trimmed = ffmpeg(['-f', 's16le', '-ar', String(SPEECH.sampleRate), '-ac', '1', '-i', 'pipe:0', '-af', PROCESSING.trim, ...F32, 'pipe:1'], pcm).stdout;
  const preGain = PROCESSING.preRadioRmsDb - activeRmsDb(trimmed);
  const radio = ffmpeg([...F32, '-i', 'pipe:0', '-af', `volume=${preGain.toFixed(3)}dB,${PROCESSING.radio}`, ...F32, 'pipe:1'], trimmed).stdout;
  const postGain = PROCESSING.finalRmsDb - activeRmsDb(radio);
  return ffmpeg(
    [...F32, '-i', 'pipe:0', '-af', `volume=${postGain.toFixed(3)}dB,alimiter=limit=${PROCESSING.limit}:level=disabled`, '-codec:a', 'libmp3lame', '-q:a', '3', '-ac', '1', '-f', 'mp3', 'pipe:1'],
    radio,
  ).stdout;
}

interface Outcome {
  id: string;
  mp3?: Buffer;
  note?: string;
  error?: string;
}

async function generate(id: string, text: string, tone: string, language: VoiceLanguage): Promise<Outcome> {
  const expected = normalise(text, language);
  let best: { similarity: number; heard: string; pcm: Buffer } = { similarity: -1, heard: '', pcm: Buffer.alloc(0) };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const pcm = await speech(text, tone, language);
      const heard = await transcribe(pcm, language);
      const score = similarity(normalise(heard, language), expected);
      if (score > best.similarity) best = { similarity: score, heard, pcm };
      if (score === 1) return { id, mp3: render(pcm) };
      if (attempt === MAX_ATTEMPTS && best.similarity >= ACCEPT_SIMILARITY) {
        return { id, mp3: render(best.pcm), note: `heard "${best.heard}" (similarity ${best.similarity.toFixed(2)})` };
      }
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) return { id, error: (error as Error).message };
    }
  }
  return { id, error: `never matched; best heard "${best.heard}" (similarity ${best.similarity.toFixed(2)})` };
}

const lines = JSON.parse(readFileSync(join(ROOT, 'src', 'audio', 'lines.json'), 'utf8')) as Record<string, Line>;
const ids = Object.keys(lines);
let anyFailed = false;

async function runLanguage(language: VoiceLanguage): Promise<void> {
  const out = join(ROOT, 'public', 'voice', language);
  const manifestFile = join(out, 'manifest.json');
  const callsBefore = apiCalls;
  mkdirSync(out, { recursive: true });
  const manifest: Record<string, string> = existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, string>) : {};

  for (const file of readdirSync(out)) {
    if (!file.endsWith('.mp3')) continue;
    const id = file.slice(0, -4);
    if (!(id in lines)) {
      rmSync(join(out, file));
      console.log(`[${language}] ${id}: removed (no longer in lines.json)`);
    }
  }
  for (const id of Object.keys(manifest)) if (!(id in lines)) delete manifest[id];

  const textOf = (line: Line): string => line[language];
  const todo = Object.entries(lines).filter(([id, line]) => !existsSync(join(out, `${id}.mp3`)) || manifest[id] !== lineHash(textOf(line), line.tone, language));
  const accepted: string[] = [];
  const failed: string[] = [];
  let generated = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const entry = todo[next];
      next += 1;
      if (entry === undefined) return;
      const [id, line] = entry;
      const outcome = await generate(id, textOf(line), line.tone, language);
      if (outcome.mp3 === undefined) {
        rmSync(join(out, `${id}.mp3`), { force: true });
        delete manifest[id];
        failed.push(`${id}: ${outcome.error}`);
        console.log(`[${language}] ${id}: FAILED ${outcome.error}`);
        continue;
      }
      const tmp = join(out, `${id}.mp3.tmp`);
      writeFileSync(tmp, outcome.mp3);
      renameSync(tmp, join(out, `${id}.mp3`));
      manifest[id] = lineHash(textOf(line), line.tone, language);
      generated += 1;
      if (outcome.note !== undefined) accepted.push(`${id}: ${outcome.note}`);
      console.log(`[${language}] ${id}: ok${outcome.note === undefined ? '' : ` (accepted with differences: ${outcome.note})`}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(manifestFile, `${JSON.stringify(sorted, null, 2)}\n`);

  console.log(`\n[${language}] ${ids.length} lines, ${generated} generated, ${ids.length - todo.length} up to date, ${failed.length} failed, ${apiCalls - callsBefore} API calls`);
  if (accepted.length > 0) console.log(`[${language}] accepted with differences:\n  ${accepted.join('\n  ')}`);
  if (failed.length > 0) {
    console.log(`[${language}] failed:\n  ${failed.join('\n  ')}`);
    anyFailed = true;
  }
}

for (const language of LANGUAGES) await runLanguage(language);
console.log(`\ntotal API calls: ${apiCalls}`);
if (anyFailed) process.exitCode = 1;
