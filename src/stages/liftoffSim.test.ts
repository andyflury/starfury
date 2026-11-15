import { describe, expect, it } from 'vitest';
import { LIFTOFF } from '../tuning.ts';
import type { InputState } from '../types.ts';
import {
  COMPLETE_ALTITUDE,
  createLiftoff,
  type LiftoffEvent,
  type LiftoffSite,
  type LiftoffState,
  poseOf,
  screenTiltOf,
  stepLiftoff,
  tiltOf,
  towerContact,
} from './liftoffSim.ts';

const DT = 1 / 60;

/** The real site: the mount's top, the camera's bearing, the stack and the tower's footprint from `world/starbase.ts`. */
const SITE: LiftoffSite = { padY: 20, yaw: 0.55, length: 121, radius: 4.5, tower: { minX: -29, maxX: -12.4, halfZ: 7, top: 156 } };
const COS = Math.cos(SITE.yaw);
const SIN = Math.sin(SITE.yaw);

/** The stick position that leans the stack along world (x, z), scaled to at most 1 per axis. */
function stickFor(x: number, z: number): { stickX: number; stickY: number } {
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  return { stickX: clamp(x * COS - z * SIN), stickY: clamp(-x * SIN - z * COS) };
}

/** A seeded pseudo-random source in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A run with its input, clock and every event so far with the time it happened. */
class Run {
  readonly random: () => number;
  readonly s: LiftoffState;
  readonly input: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: false };
  t = 0;
  readonly log: { t: number; e: LiftoffEvent }[] = [];

  constructor(armed: boolean, seed = 1) {
    this.random = seeded(seed);
    this.input.armed = armed;
    this.s = createLiftoff(armed, SITE);
  }

  /** Steps for `seconds`, calling `pilot` before every step; stops early at an ending. */
  run(seconds: number, pilot?: (r: Run) => void): this {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      pilot?.(this);
      this.t += DT;
      for (const e of stepLiftoff(this.s, DT, this.input, this.random)) this.log.push({ t: this.t, e });
      if (this.ended) break;
    }
    return this;
  }

  get ended(): boolean {
    return this.s.phase === 'failed' || this.s.phase === 'crashed' || this.s.phase === 'complete';
  }

  kinds(): string[] {
    return this.log.map(({ e }) => (e.kind === 'prompt' ? `prompt:${e.line}` : e.kind === 'count' ? `count:${e.n}` : e.kind));
  }

  first(kind: LiftoffEvent['kind']): { t: number; e: LiftoffEvent } | undefined {
    return this.log.find(({ e }) => e.kind === kind);
  }
}

/** Arms with the throttle down and runs through the countdown to T-0. */
function toIgnition(seed = 1): Run {
  const r = new Run(false, seed).run(0.5);
  r.input.armed = true;
  r.run(LIFTOFF.countdownFrom + 0.05);
  expect(r.s.phase).toBe('ignition');
  return r;
}

/** Pushes the throttle up at the keyboard's ramp rate after `delay` seconds from the call. */
function throttleUp(delay: number): (r: Run) => void {
  let t = 0;
  return (r) => {
    t += DT;
    if (t > delay) r.input.throttle = Math.min(1, r.input.throttle + 0.7 * DT);
  };
}

/**
 * Steers the tilt towards `target()` degrees along world X (positive is away from the tower), after `react` seconds of
 * seeing it, with `gain` stick per degree, and keeps the throttle rising.
 */
function pilot(target: (r: Run) => number, react = 0.4, throttle = throttleUp(0), gain = 1 / 4): (r: Run) => void {
  const seen: [number, number][] = [];
  return (r) => {
    throttle(r);
    seen.push([r.s.tiltX, r.s.tiltZ]);
    const [x, z] = seen[Math.max(0, seen.length - 1 - Math.round(react / DT))] ?? [0, 0];
    Object.assign(r.input, stickFor((target(r) - x) * gain, -z * gain));
  };
}

describe('arming', () => {
  it('asks to switch off first when the switch is armed at the start, and repeats the prompt', () => {
    const r = new Run(true).run(LIFTOFF.promptRepeat + 1);
    expect(r.s.phase).toBe('disarm');
    expect(r.kinds()).toEqual(['prompt:disarm_first', 'prompt:disarm_first']);
    r.input.armed = false;
    r.run(1);
    expect(r.s.phase).toBe('arm');
    expect(r.kinds().at(-1)).toBe('prompt:arm_prompt');
    r.input.armed = true;
    r.run(0.1);
    expect(r.kinds().at(-1)).toBe('count:10');
  });

  it('waits for the throttle to stay down before the countdown', () => {
    const r = new Run(false).run(0.5);
    r.input.throttle = 0.6;
    r.input.armed = true;
    r.run(2);
    expect(r.s.phase).toBe('throttleDown');
    expect(r.kinds()).toEqual(['prompt:arm_prompt', 'prompt:throttle_down']);
    r.input.throttle = 0;
    r.run(0.2);
    r.input.throttle = 0.3;
    r.run(0.2);
    expect(r.s.phase).toBe('throttleDown');
    r.input.throttle = LIFTOFF.throttleDown;
    r.run(LIFTOFF.throttleDownHold + 0.05);
    expect(r.s.phase).toBe('countdown');
    expect(r.kinds().at(-1)).toBe('count:10');
  });
});

describe('countdown', () => {
  it('counts from 10 to 1 once a second, builds steam from T-3 and ignites at T-0', () => {
    const r = new Run(false).run(0.5);
    r.input.armed = true;
    r.run(LIFTOFF.countdownFrom - LIFTOFF.steamFrom - 0.1);
    expect(r.s.steam).toBe(0);
    r.run(LIFTOFF.steamFrom + 0.2);
    const counts = r.log.filter(({ e }) => e.kind === 'count');
    expect(counts.map(({ e }) => (e.kind === 'count' ? e.n : 0))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!.t - counts[i - 1]!.t).toBeCloseTo(1, 1);
    expect(r.s.phase).toBe('ignition');
    expect(r.s.steam).toBe(1);
    expect(r.first('ignition')!.t - counts[0]!.t).toBeCloseTo(LIFTOFF.countdownFrom, 1);
  });

  it('stops and returns to arming when disarmed, without failing', () => {
    const r = new Run(false).run(0.5);
    r.input.armed = true;
    r.run(8.5);
    expect(r.s.steam).toBeGreaterThan(0);
    r.input.armed = false;
    r.run(0.5);
    expect(r.s.phase).toBe('arm');
    expect(r.s.digit).toBeUndefined();
    expect(r.s.steam).toBe(0);
    expect(r.kinds().at(-1)).toBe('prompt:arm_prompt');
    r.input.armed = true;
    r.run(0.1);
    expect(r.kinds().at(-1)).toBe('count:10');
  });

  it('is a false start when the throttle comes up before T-0', () => {
    const r = new Run(false).run(0.5);
    r.input.armed = true;
    r.run(6);
    r.input.throttle = LIFTOFF.falseStartThrottle + 0.05;
    r.run(1);
    expect(r.s.phase).toBe('failed');
    expect(r.kinds().at(-1)).toBe('falseStart');
    expect(r.kinds()).not.toContain('ignition');
  });
});

describe('ignition', () => {
  it('scrubs for low thrust when the band is not reached in time', () => {
    const r = toIgnition();
    r.input.throttle = LIFTOFF.liftoffBand - 0.1;
    r.run(LIFTOFF.bandDeadline + 1);
    expect(r.s.phase).toBe('failed');
    expect(r.kinds().at(-1)).toBe('lowThrust');
    expect(r.first('lowThrust')!.t - r.first('ignition')!.t).toBeCloseTo(LIFTOFF.bandDeadline, 1);
  });
});

describe('climb', () => {
  it('crashes into the tower when the tilt goes past the limit beside it', () => {
    const r = toIgnition();
    r.run(30, (x) => {
      throttleUp(0)(x);
      x.input.stickX = 0.5;
    });
    expect(r.s.phase).toBe('crashed');
    expect(r.log.at(-1)!.e).toMatchObject({ kind: 'crash', cause: 'tower' });
    expect(towerContact(r.s)).toBeUndefined();
    expect(r.s.altitude).toBeLessThan(LIFTOFF.towerClearHeight);
    expect(r.kinds()).toContain('tiltWarning');
  });

  it('crashes onto the mount when it sinks back after liftoff', () => {
    const r = toIgnition();
    r.input.throttle = 1;
    r.run(2);
    expect(r.s.altitude).toBeGreaterThan(0);
    r.input.throttle = 0.2;
    r.run(20);
    expect(r.s.phase).toBe('crashed');
    expect(r.log.at(-1)!.e).toMatchObject({ kind: 'crash', cause: 'mount' });
  });

  it('climbs slower at less throttle', () => {
    const full = toIgnition();
    full.input.throttle = 1;
    full.run(8);
    const part = toIgnition();
    part.input.throttle = LIFTOFF.liftoffBand;
    part.run(8);
    expect(part.s.altitude).toBeGreaterThan(0);
    expect(part.s.altitude).toBeLessThan(full.s.altitude * 0.8);
  });

  it('takes about climbSeconds at full throttle and clears the tower on the way', () => {
    const r = toIgnition();
    r.input.throttle = 1;
    r.run(60, pilot(() => 0));
    expect(r.s.phase).toBe('complete');
    const climb = r.log.at(-1)!.t - r.first('liftoff')!.t;
    expect(climb).toBeGreaterThan(LIFTOFF.climbSeconds - 0.3);
    expect(climb).toBeLessThan(LIFTOFF.climbSeconds + 0.3);
    expect(r.s.altitude).toBeGreaterThanOrEqual(COMPLETE_ALTITUDE);
    const clear = r.first('towerClear')!.t - r.first('liftoff')!.t;
    expect(clear).toBeGreaterThan(5);
    expect(clear).toBeLessThan(climb - 5);
  });

  it('leans the way the stick is pushed: right on screen, and up away from the camera', () => {
    const right = toIgnition();
    right.input.throttle = 1;
    right.input.stickX = 1;
    right.run(0.5);
    expect(screenTiltOf(right.s)).toBeGreaterThan(4);
    const up = toIgnition();
    up.input.throttle = 1;
    up.input.stickY = 1;
    up.run(0.5);
    expect(Math.abs(screenTiltOf(up.s))).toBeLessThan(0.5);
    expect(up.s.tiltX * SIN + up.s.tiltZ * COS).toBeLessThan(-4);
  });

  it('tilts over by itself in the wind, away from the tower, sometimes as far as a crash', () => {
    let towards = 0;
    const results = Array.from({ length: 60 }, (_, i) =>
      toIgnition(i + 1).run(60, (r) => {
        throttleUp(0)(r);
        towards = Math.max(towards, -r.s.tiltX);
      }),
    );
    const crashed = results.filter((r) => r.s.phase === 'crashed').length;
    const upright = results.filter((r) => r.s.maxTilt < LIFTOFF.smallTilt).length;
    expect(crashed).toBeGreaterThan(0);
    expect(crashed).toBeLessThan(results.length / 3);
    expect(upright).toBeLessThan(results.length / 4);
    expect(towards).toBeLessThan(0.5);
    for (const r of results) if (r.s.phase === 'crashed') expect(towerContact(r.s)).toBeUndefined();
  });

  it('sidesteps away from the tower after liftoff', () => {
    const r = toIgnition();
    r.input.throttle = 1;
    r.run(0.5);
    expect(r.s.sidestep).toBeLessThan(LIFTOFF.sidestep / 2);
    r.run(LIFTOFF.sidestepSeconds, pilot(() => 0));
    expect(r.s.sidestep).toBeCloseTo(LIFTOFF.sidestep, 5);
    expect(poseOf(r.s).base.x).toBeGreaterThan(LIFTOFF.sidestep - 2);
  });

  it('warns about the tilt at most once per cooldown', () => {
    const r = toIgnition();
    r.run(60, pilot((x) => (x.s.climbT > 3 ? LIFTOFF.crashTilt * 0.8 : 0)));
    const warnings = r.log.filter(({ e }) => e.kind === 'tiltWarning').map(({ t }) => t);
    expect(warnings.length).toBeGreaterThan(1);
    for (let i = 1; i < warnings.length; i++) expect(warnings[i]! - warnings[i - 1]!).toBeGreaterThanOrEqual(LIFTOFF.warnCooldown - 0.01);
  });
});

describe('tower collision', () => {
  it('crashes where the hull touches the tower when the stick holds a lean towards it', () => {
    const r = toIgnition();
    r.input.throttle = 1;
    r.run(60, () => Object.assign(r.input, stickFor(-0.3, 0)));
    const e = r.log.at(-1)!.e;
    expect(e).toMatchObject({ kind: 'crash', cause: 'tower' });
    expect(tiltOf(r.s)).toBeLessThan(LIFTOFF.crashTilt);
    const at = e.kind === 'crash' ? e.at : { x: 0, y: 0, z: 0 };
    const { tower } = SITE;
    expect(at.x).toBeGreaterThanOrEqual(tower.minX);
    expect(at.x).toBeLessThanOrEqual(tower.maxX);
    expect(Math.abs(at.z)).toBeLessThanOrEqual(tower.halfZ);
    expect(at.y).toBeLessThanOrEqual(tower.top);
    expect(towerContact(r.s)).toEqual(at);
  });

  it('clears the tower with a lean of about 8 degrees towards it after an overcorrection', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let towards = 0;
      const steer = pilot((x) => (x.s.climbT > 3 && x.s.climbT < 7 ? -8 : 0), 0.4, throttleUp(0), 1 / 8);
      const r = toIgnition(seed).run(60, (x) => {
        steer(x);
        towards = Math.max(towards, -x.s.tiltX);
      });
      expect(towards).toBeGreaterThan(7);
      expect(r.s.phase).toBe('complete');
    }
  });

  it('never lets the hull overlap the tower without a crash, whatever the stick does', () => {
    let hits = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const random = seeded(1000 + seed);
      const r = toIgnition(seed);
      let hold = 0;
      r.input.throttle = 1;
      for (let i = 0; i < 60 * 40 && !r.ended; i++) {
        if ((hold -= DT) <= 0) {
          hold = 0.2 + random();
          r.input.stickX = random() * 2 - 1;
          r.input.stickY = random() * 2 - 1;
          r.input.throttle = 0.7 + random() * 0.3;
        }
        const events = stepLiftoff(r.s, DT, r.input, r.random);
        if (towerContact(r.s)) {
          expect(r.s.phase).toBe('crashed');
          expect(events).toContainEqual(expect.objectContaining({ kind: 'crash', cause: 'tower' }));
          hits++;
        }
      }
    }
    expect(hits).toBeGreaterThan(5);
  });
});

describe('stars', () => {
  const seeds = [1, 2, 3, 4, 5];

  it('gives 3 stars for a quick throttle and a pilot who corrects every gust', () => {
    for (const seed of seeds) {
      const r = toIgnition(seed).run(60, pilot(() => 0));
      expect(r.s.phase).toBe('complete');
      expect(r.s.maxTilt).toBeLessThanOrEqual(LIFTOFF.smallTilt);
      expect(r.log.at(-1)!.e).toEqual({ kind: 'complete', stars: 3 });
    }
  });

  it('gives 2 stars for a slow throttle with a small tilt', () => {
    for (const seed of seeds) {
      const r = toIgnition(seed).run(60, pilot(() => 0, 0.4, throttleUp(LIFTOFF.quickBand)));
      expect(r.s.bandT).toBeGreaterThan(LIFTOFF.quickBand);
      expect(r.log.at(-1)!.e).toEqual({ kind: 'complete', stars: 2 });
    }
  });

  it('gives 2 stars for a quick throttle with a moderate tilt', () => {
    for (const seed of seeds) {
      const r = toIgnition(seed).run(60, pilot(() => (LIFTOFF.smallTilt + LIFTOFF.moderateTilt) / 2 - 1));
      expect(r.s.maxTilt).toBeGreaterThan(LIFTOFF.smallTilt);
      expect(r.log.at(-1)!.e).toEqual({ kind: 'complete', stars: 2 });
    }
  });

  it('gives 1 star for a large tilt that still clears the tower', () => {
    for (const seed of seeds) {
      const r = toIgnition(seed).run(60, pilot((x) => (x.s.towerCleared ? LIFTOFF.crashTilt + 5 : 0)));
      expect(tiltOf(r.s)).toBeGreaterThan(LIFTOFF.crashTilt);
      expect(r.log.at(-1)!.e).toEqual({ kind: 'complete', stars: 1 });
    }
  });
});
