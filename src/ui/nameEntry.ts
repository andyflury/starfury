import { el, replay, type Screen, svgBox } from './dom.ts';
import { ICONS } from './icons.ts';

/** Longest name the field accepts. */
export const NAME_MAX = 12;

const LETTER = /^[a-zäöü]$/i;

/** The name entry screen. */
export interface NameEntry extends Screen {
  /** Resolves with the confirmed upper-case name. */
  readonly done: Promise<string>;
}

/** Mounts the name entry in `overlay`, prefilled with `initial`. */
export function showNameEntry(overlay: HTMLElement, initial: string): NameEntry {
  const root = el('div', 'screen name-entry', overlay);
  const panel = el('div', 'panel name-panel', root);
  svgBox('name-keyboard', ICONS.keyboard, panel);
  const field = el('div', 'name-field', panel);
  const enter = svgBox('name-enter', ICONS.enter, panel);

  let name = initial.toUpperCase().slice(0, NAME_MAX);
  const render = (popLast: boolean): void => {
    field.replaceChildren();
    [...name].forEach((c, i) => {
      const tile = el('div', 'name-tile', field);
      tile.textContent = c;
      if (popLast && i === name.length - 1) tile.classList.add('pop');
    });
    if (name.length < NAME_MAX) el('div', 'name-tile name-cursor', field);
    enter.classList.toggle('ready', name.length > 0);
  };
  render(false);

  let resolve: (name: string) => void = () => {};
  const done = new Promise<string>((r) => {
    resolve = r;
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      name = name.slice(0, -1);
      render(false);
    } else if (e.key === 'Enter') {
      if (name.length === 0) {
        replay(field, 'shake');
        return;
      }
      window.removeEventListener('keydown', onKey);
      root.classList.add('confirmed');
      resolve(name);
    } else if (LETTER.test(e.key) && name.length < NAME_MAX) {
      name += e.key.toUpperCase();
      render(true);
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    done,
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
