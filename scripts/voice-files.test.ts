import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, lineHash } from './voice-settings.ts';

interface Line {
  tone: string;
  de: string;
  en: string;
}

const ROOT = join(import.meta.dirname, '..');
const lines = JSON.parse(readFileSync(join(ROOT, 'src', 'audio', 'lines.json'), 'utf8')) as Record<string, Line>;

describe.each(LANGUAGES)('voice files (%s)', (language) => {
  const dir = join(ROOT, 'public', 'voice', language);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, string>;

  it.each(Object.entries(lines))('%s has a current, non-empty clip', (id, line) => {
    const file = join(dir, `${id}.mp3`);
    expect(existsSync(file), `${language}/${id}.mp3 missing; run npm run voice`).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
    expect(manifest[id], `${language}/${id} is stale or missing in manifest; run npm run voice`).toBe(lineHash(line[language], line.tone, language));
  });

  it('has no clip or manifest entry without a line', () => {
    const clips = readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4));
    const extra = [...clips, ...Object.keys(manifest)].filter((id) => !(id in lines));
    expect(extra).toEqual([]);
  });
});
