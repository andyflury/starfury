import lines from './audio/lines.json';
import type { GameInput } from './input/index.ts';
import { MISSION, type MissionStep } from './stages/index.ts';
import { load, save } from './storage.ts';
import type { App, Audio, FactId, Language, LineId, Stage, StageResult, Stars } from './types.ts';
import type { Screen } from './ui/dom.ts';
import { showFactCard } from './ui/factCard.ts';
import { currentLanguage } from './ui/language.ts';
import { showNameEntry } from './ui/nameEntry.ts';
import { showPatch } from './ui/patch.ts';
import { type PickerLanding, type PickerTile, showPicker } from './ui/picker.ts';
import { showRetry } from './ui/retry.ts';
import { runSetupWizard } from './ui/setupWizard.ts';
import { showTitle } from './ui/title.ts';

/** Everything the shell runs the mission with. */
export interface ShellContext extends App {
  readonly input: GameInput;
  readonly audio: Audio;
}

/** Where the game is, for automated checks. */
export interface DebugState {
  /** The current step: `title`, `setup`, `name`, `picker`, a mission step id, or `patch`. */
  step: string;
  /** The last stage result. */
  result: StageResult | undefined;
}

declare global {
  interface Window {
    starfury: DebugState;
  }
}

const FACTS = (Object.keys(lines) as LineId[]).filter((id): id is FactId => id.startsWith('fact_') && id !== 'fact_bridge');
const shownFacts = new Set<FactId>();
let bridged = false;

/** The picker tile that starts the whole mission. */
const MISSION_TILE = 'mission';
let lastPlayed = MISSION_TILE;

type StageStep = Extract<MissionStep, { kind: 'stage' }>;
const STAGES = MISSION.filter((s): s is StageStep => s.kind === 'stage');

/** Ids of the stages whose tile is locked: those after a scored stage never completed. */
function lockedStages(): Set<string> {
  const best = load('best') ?? {};
  return new Set(STAGES.filter((_, i) => i > 0 && best[STAGES[i - 1]?.id ?? ''] === undefined).map((s) => s.id));
}

const image = (name: string): string => `${import.meta.env.BASE_URL}img/${name}.webp`;

/** Seconds after a waiting screen appears, or its voice ends, before the flip reminder plays. */
const REMIND_AFTER = 4;
const ORBIT_SPEED = 0.08;

class Aborted extends Error {}

interface Waiter {
  test(dt: number): boolean;
  resolve(): void;
  reject(e: Error): void;
}

/** Runs the game from the title through the picker, single stages and whole missions; `frame` advances it once per frame. */
export function createShell(ctx: ShellContext): { frame(dt: number): void } {
  const { world, effects, camera, input, voice, sfx, hud, overlay, audio } = ctx;
  const debug: DebugState = { step: 'title', result: undefined };
  window.starfury = debug;

  let epoch = 0;
  let waiters: Waiter[] = [];
  let screens: Screen[] = [];
  let stage: Stage | undefined;
  let polling = true;
  let loadedLanguage: Language | undefined;
  let loading: Promise<void> = Promise.resolve();
  document.documentElement.lang = currentLanguage();
  let orbitAngle = 0.6;

  /** Circles the camera around the pad with the stack left of the frame's centre. */
  const orbit = (dt: number): void => {
    orbitAngle += dt * ORBIT_SPEED;
    const p = world.padPoint;
    const h = world.booster.height + world.ship.height;
    const sin = Math.sin(orbitAngle);
    const cos = Math.cos(orbitAngle);
    camera.position.set(p.x + sin * h * 2.8, p.y + h * 0.3, p.z + cos * h * 2.8);
    camera.lookAt(p.x + cos * h * 0.6, p.y + h * 0.55, p.z - sin * h * 0.6);
    world.update(dt);
    effects.update(dt, camera);
  };
  /** Holds the camera where it is while the world and the effects keep running. */
  const hold = (): ((dt: number) => void) => {
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();
    return (dt) => {
      camera.position.copy(position);
      camera.quaternion.copy(rotation);
      world.update(dt);
      effects.update(dt, camera);
    };
  };
  let scenery: (dt: number) => void = orbit;

  /** Resolves on the first frame `test` returns true; rejects when Escape aborts the run. */
  const until = (test: (dt: number) => boolean): Promise<void> =>
    new Promise((resolve, reject) => {
      waiters.push({ test, resolve, reject });
    });
  const seconds = (s: number): Promise<void> => {
    let t = 0;
    return until((dt) => (t += dt) >= s);
  };
  /** Awaits `p`, then throws if Escape aborted the run meanwhile. */
  const guard = async <T>(p: Promise<T>): Promise<T> => {
    const mine = epoch;
    const v = await p;
    if (mine !== epoch) throw new Aborted();
    return v;
  };
  const mount = <T extends Screen>(screen: T): T => {
    screens.push(screen);
    return screen;
  };
  const unmount = (screen: Screen): void => {
    screen.dispose();
    screens = screens.filter((s) => s !== screen);
  };
  /**
   * Waits for a confirm; `REMIND_AFTER` seconds after `remindFrom` resolves without one, speaks `flip_to_continue`
   * once and calls `onRemind`.
   */
  const confirmWithReminder = (remindFrom: Promise<void>, onRemind: () => void): Promise<void> => {
    let ready = false;
    let t = 0;
    let reminded = false;
    void remindFrom.then(() => (ready = true), () => {});
    input.flush();
    return until((dt) => {
      if (ready && !reminded && (t += dt) >= REMIND_AFTER) {
        reminded = true;
        void voice.say('flip_to_continue');
        onRemind();
      }
      return input.confirm;
    });
  };

  function abort(): void {
    epoch++;
    for (const w of waiters) w.reject(new Aborted());
    waiters = [];
    for (const s of screens) s.dispose();
    screens = [];
    stage?.stop();
    stage = undefined;
    polling = true;
    voice.stop();
    sfx.stop();
    effects.clear();
    hud.clear();
  }

  function begin(): void {
    run().catch((e: unknown) => {
      if (!(e instanceof Aborted)) throw e;
    });
  }

  async function run(): Promise<void> {
    debug.step = 'title';
    world.resetToPad();
    scenery = orbit;
    const title = mount(showTitle(overlay));
    const choice = await guard(title.pressed);
    title.launch();
    const language = currentLanguage();
    if (language !== loadedLanguage) {
      loadedLanguage = language;
      loading = audio.unlock().then(() => voice.load(language));
    }
    await guard(loading);
    await guard(voice.say('welcome'));
    unmount(title);

    const jump = MISSION.findIndex((s) => s.id === new URLSearchParams(location.search).get('stage'));
    const padConnected = navigator.getGamepads().some((p) => p !== null);
    if (choice.setup || (jump < 0 && !input.mapped && padConnected)) await setup();
    if (choice.name || (jump < 0 && !load('name'))) await nameEntry();
    if (jump >= 0) await wholeMission(jump);
    let landing: PickerLanding | undefined;
    for (;;) {
      const id = await picker(landing);
      lastPlayed = id;
      landing = undefined;
      const step = STAGES.find((s) => s.id === id);
      if (step) landing = await single(step);
      else await wholeMission(0);
    }
  }

  /** Shows the picker until a tile is started; returns its id. */
  async function picker(landing: PickerLanding | undefined): Promise<string> {
    debug.step = 'picker';
    world.resetToPad();
    const best = load('best') ?? {};
    const locked = lockedStages();
    const tiles: PickerTile[] = [
      { id: MISSION_TILE, image: image('stage_mission'), stars: undefined, locked: false },
      ...STAGES.map((s) => ({ id: s.id, image: image(`stage_${s.id}`), stars: best[s.id] ?? 0, locked: locked.has(s.id) })),
    ];
    const screen = mount(showPicker(overlay, tiles, lastPlayed, landing, voice, sfx));
    input.flush();
    scenery = (dt) => {
      orbit(dt);
      screen.update(dt, input);
    };
    const id = await guard(screen.chosen);
    await guard(seconds(0.4));
    unmount(screen);
    return id;
  }

  /** Runs every step from `from` in order, then the patch. */
  async function wholeMission(from: number): Promise<void> {
    const stars = await mission(from);
    await patch(stars);
  }

  /** Runs one stage until it succeeds; returns its stars and the tile that success unlocked. */
  async function single(step: StageStep): Promise<PickerLanding> {
    const before = lockedStages();
    const stars = new Map<string, Stars>();
    await runStage(step, stars);
    const after = lockedStages();
    return { id: step.id, stars: stars.get(step.id) ?? 0, unlocks: [...before].find((id) => !after.has(id)) };
  }

  async function setup(): Promise<void> {
    debug.step = 'setup';
    polling = false;
    await guard(runSetupWizard(overlay, voice, input));
    polling = true;
  }

  async function nameEntry(): Promise<void> {
    debug.step = 'name';
    const entry = mount(showNameEntry(overlay, load('name') ?? ''));
    void voice.say('name_prompt');
    const name = await guard(entry.done);
    save('name', name);
    await guard(seconds(0.5));
    unmount(entry);
  }

  /** Runs the mission from step `from`; returns the stars of each scored stage run. */
  async function mission(from: number): Promise<Map<string, Stars>> {
    const stars = new Map<string, Stars>();
    for (const step of MISSION.slice(from)) {
      if (step.kind === 'fact') await fact(step.id);
      else await runStage(step, stars);
    }
    return stars;
  }

  async function runStage(step: Extract<MissionStep, { create: unknown }>, stars: Map<string, Stars>): Promise<void> {
    debug.step = step.id;
    const s = step.create(ctx);
    stage = s;
    for (;;) {
      input.flush();
      s.start();
      scenery = (dt) => {
        s.update(dt);
        world.update(dt);
        effects.update(dt, camera);
      };
      await until(() => s.result() !== undefined);
      const result = s.result();
      debug.result = result;
      if (result?.outcome === 'success') {
        if (s.scored) {
          sfx.success();
          stars.set(step.id, result.stars);
          const best = load('best') ?? {};
          save('best', { ...best, [step.id]: Math.max(best[step.id] ?? 0, result.stars) as Stars });
        }
        break;
      }
      scenery = hold();
      hud.clear();
      const retry = mount(showRetry(overlay));
      await confirmWithReminder(Promise.resolve(), () => {});
      unmount(retry);
      await guard(voice.say('retry'));
    }
    s.stop();
    stage = undefined;
    scenery = hold();
  }

  async function fact(stepId: string): Promise<void> {
    debug.step = stepId;
    let pool = FACTS.filter((f) => !shownFacts.has(f));
    if (pool.length === 0) {
      shownFacts.clear();
      pool = FACTS;
    }
    const id = pool[Math.floor(Math.random() * pool.length)];
    if (!id) return;
    shownFacts.add(id);
    const card = mount(showFactCard(overlay, image(id)));
    card.speaking(true);
    if (!bridged) {
      bridged = true;
      await guard(voice.say('fact_bridge'));
    }
    await guard(voice.say(id));
    card.speaking(false);
    await guard(seconds(1));
    unmount(card);
  }

  async function patch(stars: Map<string, Stars>): Promise<void> {
    debug.step = 'patch';
    world.resetToPad();
    const total = [...stars.values()].reduce<number>((a, b) => a + b, 0);
    const screen = mount(showPatch(overlay, load('name') ?? '', total, stars.size * 3, sfx));
    scenery = (dt) => {
      orbit(dt);
      screen.update(dt);
    };
    const spoken = voice.say('mission_done');
    await guard(screen.landed);
    await confirmWithReminder(spoken, () => screen.showHint());
    unmount(screen);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || debug.step === 'title') return;
    abort();
    begin();
  });
  begin();

  return {
    frame(dt) {
      if (polling) input.poll();
      scenery(dt);
      for (const w of [...waiters]) {
        if (w.test(dt)) {
          waiters = waiters.filter((x) => x !== w);
          w.resolve();
        }
      }
    },
  };
}
