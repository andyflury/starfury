import { load, save } from '../storage.ts';
import type { Language } from '../types.ts';

/** The stored language, or on a first visit German for a German browser and English otherwise. */
export function currentLanguage(): Language {
  return load('language') ?? (navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en');
}

/** Stores `language` and sets the document's `lang` to it. */
export function setLanguage(language: Language): void {
  save('language', language);
  document.documentElement.lang = language;
}

const STAR_DOTS = Array.from({ length: 20 }, (_, i) => `<circle cx="${9 + (i % 5) * 14 + (Math.floor(i / 5) % 2) * 7}" cy="${8 + Math.floor(i / 5) * 12}" r="3"/>`).join('');

/** Inline SVG flag of `language`: Germany for German, the United States for English. */
export function flagSvg(language: Language): string {
  if (language === 'de') {
    return `<svg viewBox="0 0 90 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect width="90" height="20" fill="#000000"/><rect y="20" width="90" height="20" fill="#dd0000"/><rect y="40" width="90" height="20" fill="#ffce00"/></svg>`;
  }
  const stripes = Array.from({ length: 7 }, (_, i) => `<rect y="${(i * 2 * 60) / 13}" width="114" height="${60 / 13}" fill="#b22234"/>`).join('');
  return `<svg viewBox="0 0 114 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect width="114" height="60" fill="#ffffff"/>${stripes}<rect width="76" height="${(7 * 60) / 13}" fill="#3c3b6e"/><g fill="#ffffff">${STAR_DOTS}</g></svg>`;
}
