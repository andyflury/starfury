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

/**
 * Mounts the name entry in `overlay`, prefilled with `initial`. An invisible text input over the letter tiles takes
 * the typing, so a tap on the tiles brings up the on-screen keyboard; the tiles show the letters accepted.
 */
export function showNameEntry(overlay: HTMLElement, initial: string): NameEntry {
  const root = el('div', 'screen name-entry', overlay);
  const panel = el('div', 'panel name-panel', root);
  svgBox('name-keyboard', ICONS.keyboard, panel);
  const box = el('div', 'name-box', panel);
  const field = el('div', 'name-field', box);
  const input = el('input', 'name-input', box);
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('aria-label', 'name');
  const accept = el('button', 'name-enter', panel);
  accept.innerHTML = ICONS.enter;

  let name = '';
  const render = (popLast: boolean): void => {
    field.replaceChildren();
    [...name].forEach((c, i) => {
      const tile = el('div', 'name-tile', field);
      tile.textContent = c;
      if (popLast && i === name.length - 1) tile.classList.add('pop');
    });
    if (name.length < NAME_MAX) el('div', 'name-tile name-cursor', field);
    accept.classList.toggle('ready', name.length > 0);
  };
  /** Keeps only the allowed letters in the input, leaving it untouched when nothing was dropped. */
  const take = (): void => {
    const kept = [...input.value].filter((c) => LETTER.test(c)).slice(0, NAME_MAX).join('');
    if (kept !== input.value) input.value = kept;
    const grew = kept.length > name.length;
    name = kept.toUpperCase();
    render(grew);
  };
  input.value = initial;
  take();
  render(false);

  let resolve: (name: string) => void = () => {};
  const done = new Promise<string>((r) => {
    resolve = r;
  });
  let confirmed = false;
  const confirm = (): void => {
    if (confirmed) return;
    if (name.length === 0) {
      replay(field, 'shake');
      input.focus();
      return;
    }
    confirmed = true;
    input.blur();
    root.classList.add('confirmed');
    resolve(name);
  };
  input.addEventListener('input', take);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    confirm();
  });
  accept.addEventListener('pointerdown', (e) => e.preventDefault());
  accept.addEventListener('click', confirm);
  root.addEventListener('pointerdown', (e) => {
    if (e.target !== input && e.target !== accept && !accept.contains(e.target as Node)) {
      e.preventDefault();
      input.focus();
    }
  });
  input.focus();

  return {
    done,
    dispose() {
      root.remove();
    },
  };
}
