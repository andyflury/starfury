import type { Input, Sfx, Stars, Voice } from '../types.ts';
import { el, replay, type Screen, svgBox } from './dom.ts';
import { ICONS } from './icons.ts';

/** One picker tile: the whole mission (no stars) or a scored stage with its best stars. */
export interface PickerTile {
  readonly id: string;
  readonly image: string;
  /** Best stars, or undefined for the whole-mission tile. */
  readonly stars: Stars | undefined;
  readonly locked: boolean;
}

/** Stars just won on a tile and the tile that the win unlocked, animated when the picker opens. */
export interface PickerLanding {
  readonly id: string;
  readonly stars: Stars;
  readonly unlocks: string | undefined;
}

/** The stage picker screen. */
export interface Picker extends Screen {
  /** Resolves with the id of the tile started. */
  readonly chosen: Promise<string>;
  /** Moves the highlight from the stick, starts on a confirm, plays the landing; called once per frame after `poll`. */
  update(dt: number, input: Input): void;
}

const STICK_PUSH = 0.6;
const STICK_RELEASE = 0.3;
const PROMPT_AGAIN = 12;
const LAND_FIRST = 0.5;
const LAND_GAP = 0.5;
const UNLOCK_AFTER = 0.5;

/** Columns for `n` tiles: one row up to four, otherwise two rows. */
const columnsFor = (n: number): number => (n <= 4 ? n : Math.ceil(n / 2));

/**
 * Mounts the picker in `overlay` with the highlight on `selected`; speaks `picker_prompt` on opening and again after
 * a stretch without input. Its home button calls `home`.
 */
export function showPicker(
  overlay: HTMLElement,
  tiles: readonly PickerTile[],
  selected: string,
  landing: PickerLanding | undefined,
  voice: Voice,
  sfx: Sfx,
  home: () => void,
): Picker {
  const root = el('div', 'screen picker', overlay);
  const grid = el('div', 'picker-grid', root);
  const cols = columnsFor(tiles.length);
  grid.style.setProperty('--cols', String(cols));
  grid.style.setProperty('--tile', cols <= 3 ? '38vmin' : '30vmin');

  const locked = tiles.map((t) => t.locked || t.id === landing?.unlocks);
  const nodes = tiles.map((t, i) => {
    const tile = el('button', `picker-tile${t.stars === undefined ? ' picker-mission' : ''}`, grid);
    const picture = el('div', 'picker-picture', tile);
    picture.style.backgroundImage = `url("${t.image}")`;
    svgBox('picker-lock', ICONS.padlock, tile);
    const row = el('div', 'picker-stars', tile);
    if (t.stars === undefined) svgBox('picker-star picker-badge', ICONS.rocket, row);
    const stars = t.stars === undefined ? [] : [0, 1, 2].map(() => svgBox('picker-star', ICONS.star, row));
    const shown = t.id === landing?.id ? 0 : (t.stars ?? 0);
    stars.forEach((s, k) => s.classList.toggle('lit', k < shown));
    tile.classList.toggle('locked', locked[i] ?? false);
    return { tile, stars };
  });

  let index = Math.max(0, tiles.findIndex((t) => t.id === selected));
  const highlight = (): void => nodes.forEach((n, i) => n.tile.classList.toggle('selected', i === index));
  highlight();

  let resolve: (id: string) => void = () => {};
  const chosen = new Promise<string>((r) => {
    resolve = r;
  });
  let done = false;
  const start = (i: number): void => {
    const node = nodes[i];
    const tile = tiles[i];
    if (done || !node || !tile) return;
    if (locked[i]) {
      replay(node.tile, 'shake');
      return;
    }
    done = true;
    index = i;
    highlight();
    node.tile.classList.add('launch');
    resolve(tile.id);
  };

  let idle = 0;
  let prompted = false;
  const move = (dx: number, dy: number): void => {
    idle = 0;
    const next = index + dx + dy * cols;
    if (dx !== 0 && Math.floor(next / cols) !== Math.floor(index / cols)) return;
    if (next < 0 || next >= tiles.length) return;
    index = next;
    highlight();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[e.code];
    if (d) move(d[0], d[1]);
  };
  window.addEventListener('keydown', onKey);
  nodes.forEach((n, i) => {
    n.tile.addEventListener('pointerdown', (e) => e.stopPropagation());
    n.tile.addEventListener('click', () => {
      idle = 0;
      start(i);
    });
  });
  const homeButton = el('button', 'corner-button corner-left', root);
  homeButton.innerHTML = ICONS.home;
  homeButton.addEventListener('pointerdown', (e) => e.stopPropagation());
  homeButton.addEventListener('click', home);

  void voice.say('picker_prompt');

  let stickHeld = false;
  let time = 0;
  let landed = 0;
  const landIndex = landing ? tiles.findIndex((t) => t.id === landing.id) : -1;
  const unlockIndex = landing?.unlocks ? tiles.findIndex((t) => t.id === landing.unlocks) : -1;
  const landEnd = landing ? LAND_FIRST + Math.max(0, landing.stars - 1) * LAND_GAP + UNLOCK_AFTER : 0;
  let settled = landing === undefined;

  return {
    chosen,
    update(dt, input) {
      time += dt;
      idle += dt;
      if (landing && !settled) {
        const node = nodes[landIndex];
        while (node && landed < landing.stars && time >= LAND_FIRST + landed * LAND_GAP) {
          const star = node.stars[landed];
          star?.classList.add('lit');
          if (star) replay(star, 'land');
          sfx.star();
          landed++;
        }
        if (time >= landEnd) {
          settled = true;
          const best = tiles[landIndex]?.stars ?? 0;
          node?.stars.forEach((s, k) => s.classList.toggle('lit', k < best));
          const opened = nodes[unlockIndex];
          if (opened) {
            locked[unlockIndex] = false;
            opened.tile.classList.remove('locked');
            replay(opened.tile, 'unlock');
          }
        }
      }
      if (input.source === 'gamepad') {
        const { stickX, stickY } = input.state;
        const mag = Math.max(Math.abs(stickX), Math.abs(stickY));
        if (!stickHeld && mag >= STICK_PUSH) {
          stickHeld = true;
          if (Math.abs(stickX) >= Math.abs(stickY)) move(Math.sign(stickX), 0);
          else move(0, -Math.sign(stickY));
        } else if (stickHeld && mag <= STICK_RELEASE) stickHeld = false;
      }
      if (input.confirm) {
        idle = 0;
        if (settled) start(index);
      }
      if (!prompted && idle >= PROMPT_AGAIN) {
        prompted = true;
        void voice.say('picker_prompt');
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
