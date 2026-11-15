import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineHash } from './voice-settings.ts';

interface Line {
  text: string;
  tone: string;
}

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'public', 'voice', 'de');
const lines = JSON.parse(readFileSync(join(ROOT, 'src', 'audio', 'lines.json'), 'utf8')) as Record<string, Line>;
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, string>;

describe('voice files', () => {
  it.each(Object.entries(lines))('%s has a current, non-empty clip', (id, line) => {
    const file = join(DIR, `${id}.mp3`);
    expect(existsSync(file), `${id}.mp3 missing; run npm run voice`).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
    expect(manifest[id], `${id} is stale or missing in manifest; run npm run voice`).toBe(lineHash(line.text, line.tone));
  });

  it('has no clip or manifest entry without a line', () => {
    const clips = readdirSync(DIR).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4));
    const extra = [...clips, ...Object.keys(manifest)].filter((id) => !(id in lines));
    expect(extra).toEqual([]);
  });
});
