// Generates the fact-card illustrations into public/img and keeps public/img/manifest.json in step with scripts/image-prompts.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'img');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const MAX_BYTES = 300 * 1024;
const MAX_WIDTH = 1536;

const MODEL = 'gpt-image-2.6-sunburst';
const TILE_IDS = ['stage_mission', 'stage_liftoff', 'stage_maxq', 'stage_staging', 'stage_catch', 'stage_deploy', 'stage_reentry', 'stage_shipcatch'];

interface Kind {
  request: Record<string, string | number>;
  encoding: { codec: string; startQuality: number; minQuality: number; maxWidth: number; maxBytes: number };
}

const KINDS: Record<'fact' | 'tile', Kind> = {
  fact: {
    request: { model: MODEL, size: '1536x1024', quality: 'high', output_format: 'png', background: 'opaque', n: 1 },
    encoding: { codec: 'libwebp', startQuality: 85, minQuality: 40, maxWidth: MAX_WIDTH, maxBytes: MAX_BYTES },
  },
  tile: {
    request: { model: MODEL, size: '1024x1024', quality: 'high', output_format: 'png', background: 'opaque', n: 1 },
    encoding: { codec: 'libwebp', startQuality: 85, minQuality: 40, maxWidth: 768, maxBytes: 150 * 1024 },
  },
};

interface Prompts {
  style: string;
  tileStyle: string;
  facts: Record<string, string>;
  tiles: Record<string, string>;
}

interface Job {
  kind: 'fact' | 'tile';
  text: string;
}

const prompts = JSON.parse(readFileSync(join(import.meta.dirname, 'image-prompts.json'), 'utf8')) as Prompts;
const lines = JSON.parse(readFileSync(join(ROOT, 'src', 'audio', 'lines.json'), 'utf8')) as unknown;
const lineIds = Array.isArray(lines) ? lines.map((l) => (l as { id: string }).id) : Object.keys(lines as Record<string, unknown>);
const expected = lineIds.filter((id) => id.startsWith('fact_') && id !== 'fact_bridge').sort();
const factIds = Object.keys(prompts.facts).sort();
if (JSON.stringify(expected) !== JSON.stringify(factIds)) {
  throw new Error(`image-prompts.json fact ids [${factIds.join(', ')}] differ from lines.json fact ids [${expected.join(', ')}]`);
}
const tileIds = Object.keys(prompts.tiles).sort();
if (JSON.stringify([...TILE_IDS].sort()) !== JSON.stringify(tileIds)) {
  throw new Error(`image-prompts.json tile ids [${tileIds.join(', ')}] differ from [${TILE_IDS.join(', ')}]`);
}

const jobs = new Map<string, Job>([
  ...factIds.map((id): [string, Job] => [id, { kind: 'fact', text: prompts.facts[id] ?? '' }]),
  ...tileIds.map((id): [string, Job] => [id, { kind: 'tile', text: `${prompts.tileStyle}\n\n${prompts.tiles[id] ?? ''}` }]),
]);
const ids = [...jobs.keys()].sort();

const hashOf = (id: string): string => {
  const job = jobs.get(id) as Job;
  const kind = KINDS[job.kind];
  return createHash('sha256')
    .update(JSON.stringify({ style: prompts.style, prompt: job.text, request: kind.request, encoding: kind.encoding }))
    .digest('hex');
};

mkdirSync(OUT_DIR, { recursive: true });
const manifest: Record<string, string> = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>) : {};

for (const id of Object.keys(manifest)) {
  if (!jobs.has(id)) {
    rmSync(join(OUT_DIR, `${id}.webp`), { force: true });
    delete manifest[id];
  }
}
for (const file of readdirSync(OUT_DIR)) {
  if (file.endsWith('.webp') && !jobs.has(file.slice(0, -5))) rmSync(join(OUT_DIR, file));
}

const stale = ids.filter((id) => manifest[id] !== hashOf(id) || !existsSync(join(OUT_DIR, `${id}.webp`)));

/** Requests one image and returns the PNG bytes. */
async function generate(id: string): Promise<Buffer> {
  const key = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_KEY or OPENAI_API_KEY is not set');
  const job = jobs.get(id) as Job;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...KINDS[job.kind].request, prompt: `${prompts.style}\n\n${job.text}` }),
    signal: AbortSignal.timeout(600_000),
  });
  const body = (await res.json()) as { data?: { b64_json?: string }[]; error?: { message?: string } };
  const b64 = body.data?.[0]?.b64_json;
  if (!res.ok || !b64) throw new Error(`${id}: HTTP ${res.status} ${body.error?.message ?? 'no image in response'}`);
  return Buffer.from(b64, 'base64');
}

/** Converts a PNG to WebP, lowering quality until the file fits the size limit. */
function encode(png: Buffer, dest: string, kind: Kind): void {
  const src = join(tmpdir(), `starfury-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  writeFileSync(src, png);
  try {
    const { codec, startQuality, minQuality, maxWidth, maxBytes } = kind.encoding;
    for (let q = startQuality; ; q -= 5) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale='min(${maxWidth},iw)':-2`, '-c:v', codec, '-quality', String(q), dest]);
      if (statSync(dest).size <= maxBytes) return;
      if (q <= minQuality) throw new Error(`${dest} exceeds ${maxBytes} bytes at quality ${q}`);
    }
  } finally {
    rmSync(src, { force: true });
  }
}

const results = await Promise.allSettled(
  stale.map(async (id) => {
    encode(await generate(id), join(OUT_DIR, `${id}.webp`), KINDS[(jobs.get(id) as Job).kind]);
    manifest[id] = hashOf(id);
    console.log(`generated ${id}`);
  }),
);

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
for (const f of failed) console.error(String(f.reason));
if (failed.length > 0) process.exit(1);
console.log(stale.length === 0 ? 'images up to date' : `${stale.length} generated`);
