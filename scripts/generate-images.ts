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

const REQUEST = { model: 'gpt-image-2.6-sunburst', size: '1536x1024', quality: 'high', output_format: 'png', background: 'opaque', n: 1 };
const ENCODING = { codec: 'libwebp', startQuality: 85, minQuality: 40, maxWidth: MAX_WIDTH, maxBytes: MAX_BYTES };

interface Prompts {
  style: string;
  prompts: Record<string, string>;
}

const prompts = JSON.parse(readFileSync(join(import.meta.dirname, 'image-prompts.json'), 'utf8')) as Prompts;
const lines = JSON.parse(readFileSync(join(ROOT, 'src', 'audio', 'lines.json'), 'utf8')) as unknown;
const lineIds = Array.isArray(lines) ? lines.map((l) => (l as { id: string }).id) : Object.keys(lines as Record<string, unknown>);
const expected = lineIds.filter((id) => id.startsWith('fact_') && id !== 'fact_bridge').sort();
const ids = Object.keys(prompts.prompts).sort();
if (JSON.stringify(expected) !== JSON.stringify(ids)) {
  throw new Error(`image-prompts.json ids [${ids.join(', ')}] differ from lines.json fact ids [${expected.join(', ')}]`);
}

const hashOf = (id: string): string =>
  createHash('sha256')
    .update(JSON.stringify({ style: prompts.style, prompt: prompts.prompts[id], request: REQUEST, encoding: ENCODING }))
    .digest('hex');

mkdirSync(OUT_DIR, { recursive: true });
const manifest: Record<string, string> = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>) : {};

for (const id of Object.keys(manifest)) {
  if (!(id in prompts.prompts)) {
    rmSync(join(OUT_DIR, `${id}.webp`), { force: true });
    delete manifest[id];
  }
}
for (const file of readdirSync(OUT_DIR)) {
  if (file.endsWith('.webp') && !(file.slice(0, -5) in prompts.prompts)) rmSync(join(OUT_DIR, file));
}

const stale = ids.filter((id) => manifest[id] !== hashOf(id) || !existsSync(join(OUT_DIR, `${id}.webp`)));

/** Requests one image and returns the PNG bytes. */
async function generate(id: string): Promise<Buffer> {
  const key = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_KEY or OPENAI_API_KEY is not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...REQUEST, prompt: `${prompts.style}\n\n${prompts.prompts[id]}` }),
    signal: AbortSignal.timeout(600_000),
  });
  const body = (await res.json()) as { data?: { b64_json?: string }[]; error?: { message?: string } };
  const b64 = body.data?.[0]?.b64_json;
  if (!res.ok || !b64) throw new Error(`${id}: HTTP ${res.status} ${body.error?.message ?? 'no image in response'}`);
  return Buffer.from(b64, 'base64');
}

/** Converts a PNG to WebP, lowering quality until the file fits the size limit. */
function encode(png: Buffer, dest: string): void {
  const src = join(tmpdir(), `starfury-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  writeFileSync(src, png);
  try {
    for (let q = ENCODING.startQuality; ; q -= 5) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale='min(${MAX_WIDTH},iw)':-2`, '-c:v', ENCODING.codec, '-quality', String(q), dest]);
      if (statSync(dest).size <= MAX_BYTES) return;
      if (q <= ENCODING.minQuality) throw new Error(`${dest} exceeds ${MAX_BYTES} bytes at quality ${q}`);
    }
  } finally {
    rmSync(src, { force: true });
  }
}

const results = await Promise.allSettled(
  stale.map(async (id) => {
    encode(await generate(id), join(OUT_DIR, `${id}.webp`));
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
