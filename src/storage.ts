import type { Stars } from './types.ts';

/** Everything the game keeps in `localStorage`, each under `starfury.<key>`. */
export interface Stored {
  /** The controller mapping, shaped by `input/mapping.ts`. */
  mapping: unknown;
  name: string;
  /** Best stars per scored stage, by the stage's id. */
  best: Record<string, Stars>;
}

/** The stored value of `key`; undefined when absent, unreadable or storage is blocked. */
export function load<K extends keyof Stored>(key: K): Stored[K] | undefined {
  try {
    const raw = localStorage.getItem(`starfury.${key}`);
    return raw === null ? undefined : (JSON.parse(raw) as Stored[K]);
  } catch {
    return undefined;
  }
}

/** Stores `value` under `key`, or removes the key for undefined; a blocked storage drops the write. */
export function save<K extends keyof Stored>(key: K, value: Stored[K] | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(`starfury.${key}`);
    else localStorage.setItem(`starfury.${key}`, JSON.stringify(value));
  } catch {
    // storage blocked
  }
}
