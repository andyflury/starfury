import type { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import type lines from './audio/lines.json';

/** A voice line's id: a key of `audio/lines.json` and the basename of its MP3. */
export type LineId = keyof typeof lines;

/** The fact lines a fact card can show; each has an illustration at `img/<id>.webp`. */
export type FactId = Exclude<Extract<LineId, `fact_${string}`>, 'fact_bridge'>;

export type Stars = 0 | 1 | 2 | 3;

/** One frame of mapped player input: dead zone, range and inversion already applied. */
export interface InputState {
  /** Absolute throttle level, 0 at the bottom to 1 at the top. */
  throttle: number;
  /** Right stick, -1 left to +1 right. */
  stickX: number;
  /** Right stick, -1 down to +1 up. */
  stickY: number;
  /** Arm switch position. */
  armed: boolean;
}

export interface Input {
  /** Reads the devices; called once per frame before `state` and `confirm` are read. */
  poll(): void;
  readonly state: InputState;
  /** True for the one poll after the Arm switch changed position, or Enter, R or a pointer press arrived. */
  readonly confirm: boolean;
  /** Drops a confirm that has not been polled yet; called on every screen change. */
  flush(): void;
  /** `gamepad` while a mapped controller is connected, `keyboard` otherwise. */
  readonly source: 'gamepad' | 'keyboard';
  /** Whether a controller mapping is stored. */
  readonly mapped: boolean;
}

export interface Voice {
  /** Fetches and decodes every line's MP3; a line without a file plays nothing. */
  load(): Promise<void>;
  /** Speaks a line, cutting off the one playing and dropping the queue; resolves when it ends or is cut off. */
  say(id: LineId): Promise<void>;
  /** Speaks a line after the ones playing and queued; resolves when it ends or is cut off. */
  queue(id: LineId): Promise<void>;
  /** Cuts off the line playing and drops the queue. */
  stop(): void;
  readonly speaking: boolean;
}

export interface Sfx {
  /** Engine rumble, 0 silent to 1 full; holds until set again. */
  setEngine(level: number): void;
  explosion(): void;
  /** One countdown tick. */
  tick(): void;
  /** The chopsticks closing on the booster. */
  clank(): void;
  /** An abort or a scrub. */
  fail(): void;
  /** A stage completed. */
  success(): void;
  /** One star landing on the patch. */
  star(): void;
  /** Silences the engine and every running sound. */
  stop(): void;
}

/** Both audio outputs on one AudioContext. */
export interface Audio {
  /** Resumes the AudioContext; called from the first key or pointer press. */
  unlock(): Promise<void>;
  readonly voice: Voice;
  readonly sfx: Sfx;
}

/** A rocket stage. Its origin is the centre of its base and +Y runs along its long axis. */
export interface Vehicle {
  readonly object: Group;
  readonly height: number;
  readonly radius: number;
  readonly engineCount: number;
  /** Lights the first `count` engines, centre outward. */
  setEnginesLit(count: number): void;
}

export interface Booster extends Vehicle {
  /** Height above the base of the pins the chopsticks catch. */
  readonly catchPinHeight: number;
}

export interface Tower {
  readonly object: Group;
  /** Where the booster's catch pins rest when caught, on the launch mount's axis, in world space. */
  readonly catchPoint: Vector3;
  /** Half the gap between the open arms at the catch point. */
  readonly catchHalfWidth: number;
  /**
   * The two chopstick arms held open, mirrored in z. Each runs from its pivot at x = `pivotX` towards +X for `length`
   * metres measured along the arm; its inner face is at |z| = `catchHalfWidth` + x × `openSlope`. `halfWidth` is half
   * an arm's horizontal thickness, and the arms lie within `halfHeight` of the catch point's height.
   */
  readonly arms: { readonly pivotX: number; readonly length: number; readonly openSlope: number; readonly halfWidth: number; readonly halfHeight: number };
  /** The tower's solid extent: x from `minX` to `maxX`, |z| up to `halfZ`, y from the ground up to `top`. */
  readonly footprint: { readonly minX: number; readonly maxX: number; readonly halfZ: number; readonly top: number };
  /** 0 holds the arms open, 1 closed around a booster at the catch point. */
  setChopsticks(closed: number): void;
}

/**
 * Starbase. Metres, +Y up, ground at y = 0, the launch mount's axis at x = 0 and z = 0, the tower on the mount's
 * -X side and the sea towards -Z.
 */
export interface World {
  readonly root: Group;
  readonly tower: Tower;
  readonly booster: Booster;
  readonly ship: Vehicle;
  /** Where the booster's base stands on the launch mount, in world space. */
  readonly padPoint: Vector3;
  /** Radius of the launch mount's table, centred on the mount's axis with its top at `padPoint`'s height. */
  readonly mountRadius: number;
  /** Stands the booster on the mount with the ship stacked on it: upright, visible, engines off, arms open. */
  resetToPad(): void;
  /** Animates the sea and the clouds. */
  update(dt: number): void;
}

export interface Effects {
  /** A vehicle's exhaust plume, 0 off to 1 full; holds until set again. */
  setExhaust(vehicle: Vehicle, level: number): void;
  /** Steam and dust billowing from the launch mount, 0 off to 1 full; holds until set again. */
  setPadSteam(level: number): void;
  /** Starts an explosion at a world position. */
  explode(at: Vector3): void;
  /** Adds camera shake, 0 to 1, that decays by itself. */
  shake(strength: number): void;
  /** Advances the particles and offsets the camera by the shake; called each frame after the camera is placed. */
  update(dt: number, camera: PerspectiveCamera): void;
  /** Removes every particle, plume and shake. */
  clear(): void;
}

export type HintIcon = 'arm-on' | 'arm-off' | 'throttle-up' | 'throttle-down' | 'flip';
export type SpeedLight = 'green' | 'yellow' | 'red';

/** The icon-only overlay shown while a stage runs. Every element is hidden until set and hides on `undefined`. */
export interface Hud {
  /** The throttle bar at `level`, the band from `bandFrom` to the top marked when given. */
  setThrottle(level: number | undefined, bandFrom?: number): void;
  /** The fuel bar, 0 empty to 1 full. */
  setFuel(level: number | undefined): void;
  /** The descent speed light. */
  setSpeedLight(light: SpeedLight | undefined): void;
  /** The big countdown digit. */
  setCountdown(n: number | undefined): void;
  /** The tilt gauge, degrees from upright, with the crash limit marked. */
  setTilt(degrees: number | undefined, limit?: number): void;
  /** The animated controller hint showing which stick or switch to move. */
  setHint(icon: HintIcon | undefined): void;
  /** Hides every element. */
  clear(): void;
}

/** What a stage or a screen gets from the app. */
export interface App {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly world: World;
  readonly effects: Effects;
  readonly input: Input;
  readonly voice: Voice;
  readonly sfx: Sfx;
  readonly hud: Hud;
  /** The DOM layer over the canvas that screens mount into. */
  readonly overlay: HTMLElement;
}

export type StageResult = { outcome: 'success'; stars: Stars } | { outcome: 'fail'; stars: 0 };

/** One playable or scripted part of the mission. The app runs the stages of `stages/index.ts` in order. */
export interface Stage {
  /** Whether the stage awards stars; a cutscene does not. */
  readonly scored: boolean;
  /** Puts the world, the camera and the HUD into the stage's starting state; called on entry and on every retry. */
  start(): void;
  /** Advances the stage by `dt` seconds; reads `app.input.state`, places the camera. */
  update(dt: number): void;
  /** Undefined while the stage runs; set once its ending (voice line, explosion, catch) has played out. */
  result(): StageResult | undefined;
  /** Removes what the stage added to the scene and clears the HUD and the effects. */
  stop(): void;
}

export type StageFactory = (app: App) => Stage;
