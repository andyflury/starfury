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
  /** Resolves on the first key press, start-button press or corner-button press. */
  readonly pressed: Promise<TitleChoice>;
  /** Swaps the start button for its launch animation while the welcome line plays. */
  launch(): void;
}

/** Mounts the title screen in `overlay`; its flag button switches the voice language without starting. */
export function showTitle(overlay: HTMLElement): TitleScreen {
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
  languageButton.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const next = currentLanguage() === 'de' ? 'en' : 'de';
    setLanguage(next);
    languageButton.innerHTML = flagSvg(next);
  });

  let resolve: (choice: TitleChoice) => void = () => {};
  const pressed = new Promise<TitleChoice>((r) => {
    resolve = r;
  });
  const finish = (choice: TitleChoice): void => {
    window.removeEventListener('keydown', onKey);
    resolve(choice);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') finish({ setup: false, name: false });
  };
  const onPress = (choice: TitleChoice) => (e: PointerEvent): void => {
    e.stopPropagation();
    finish(choice);
  };
  window.addEventListener('keydown', onKey);
  start.addEventListener('pointerdown', onPress({ setup: false, name: false }));
  setupButton.addEventListener('pointerdown', onPress({ setup: true, name: false }));
  nameButton.addEventListener('pointerdown', onPress({ setup: false, name: true }));

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
