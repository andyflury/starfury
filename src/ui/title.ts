import { el, type Screen, svgBox } from './dom.ts';
import { ICONS } from './icons.ts';
import { currentLanguage, flagSvg, setLanguage } from './language.ts';
import { wordmarkSvg } from './wordmark.ts';

/** Which parent options the start press asked for. */
export interface TitleChoice {
  setup: boolean;
  name: boolean;
}

/** The title screen over the orbiting 3D scene. */
export interface TitleScreen extends Screen {
  /** Resolves on the first key press or a click of the start button or the setup or name corner button. */
  readonly pressed: Promise<TitleChoice>;
  /** Swaps the start button for its launch animation while the welcome line plays. */
  launch(): void;
}

/**
 * Mounts the title screen in `overlay`; the start press calls `unlock` from inside the user's gesture. Its flag button
 * switches the voice language without starting.
 */
export function showTitle(overlay: HTMLElement, unlock: () => void): TitleScreen {
  const root = el('div', 'screen title', overlay);
  svgBox('title-logo', wordmarkSvg(), root);
  const start = el('button', 'title-start', root);
  start.innerHTML = `<span class="title-start-ring"></span><span class="title-start-ring ring-2"></span>${ICONS.rocket}`;
  const setupButton = el('button', 'corner-button corner-left', root);
  setupButton.innerHTML = ICONS.controllerRedo;
  const nameButton = el('button', 'corner-button corner-right', root);
  nameButton.innerHTML = ICONS.nameTag;
  const languageButton = el('button', 'corner-button corner-bottom-left language-button', root);
  languageButton.innerHTML = flagSvg(currentLanguage());
  languageButton.addEventListener('click', () => {
    const next = currentLanguage() === 'de' ? 'en' : 'de';
    setLanguage(next);
    languageButton.innerHTML = flagSvg(next);
  });

  let resolve: (choice: TitleChoice) => void = () => {};
  const pressed = new Promise<TitleChoice>((r) => {
    resolve = r;
  });
  /** Resolves the press, calls `unlock`, then asks for fullscreen; runs inside the press's event handler, never reorder. */
  const finish = (choice: TitleChoice): void => {
    window.removeEventListener('keydown', onKey);
    unlock();
    document.documentElement.requestFullscreen?.().catch(() => {});
    resolve(choice);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') finish({ setup: false, name: false });
  };
  window.addEventListener('keydown', onKey);
  start.addEventListener('click', () => finish({ setup: false, name: false }));
  setupButton.addEventListener('click', () => finish({ setup: true, name: false }));
  nameButton.addEventListener('click', () => finish({ setup: false, name: true }));

  return {
    pressed,
    launch() {
      root.classList.add('launching');
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
