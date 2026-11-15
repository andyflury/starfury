import { describe, expect, it } from 'vitest';
import { REENTRY } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';
import { attitudeOf, createReentry, errorOf, intensityAt, type Point, type ReentryEvent, type ReentryState, stepReentry } from './reentrySim.ts';

const DT = 1 / 60;

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

/** A run with its input and every event so far with the time it happened. */
class Run {
  readonly s: ReentryState = createReentry();
  readonly input: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: true };
  readonly log: { t: number; e: ReentryEvent }[] = [];

  constructor(readonly random: () => number = seeded(1)) {}

  /** Steps for `seconds`, calling `pilot` before every step; stops early at an ending. */
  run(seconds: number, pilot?: (r: Run) => void): this {
    for (let i = 0; i < Math.round(seconds / DT) && this.s.phase === 'flying'; i++) {
      pilot?.(this);
      for (const e of stepReentry(this.s, DT, this.input, this.random)) this.log.push({ t: this.s.t, e });
    }
    return this;
  }

  /** Every event of kind `kind` so far. */
  events<K extends ReentryEvent['kind']>(kind: K): { t: number; e: Extract<ReentryEvent, { kind: K }> }[] {
    return this.log.filter((l): l is { t: number; e: Extract<ReentryEvent, { kind: K }> } => l.e.kind === kind);
  }
}

/** Holds the ship in the safe attitude. */
const hold = (r: Run): void => {
  r.s.roll = 0;
  r.s.pitch = 0;
};

/**
 * A pilot that moves the tilt level's dot (roll right, pitch up) back to the middle: sees it `delay` seconds late,
 * ignores it below `dead` degrees and reaches stick `cap` at `dead + full` degrees.
 */
function pilot(delay: number, dead: number, full: number, cap: number): (r: Run) => void {
  const seen: { roll: number; pitch: number }[] = [];
  return (r) => {
    seen.push({ roll: r.s.roll, pitch: r.s.pitch });
    const e = seen[Math.max(0, seen.length - 1 - Math.round(delay / DT))] ?? { roll: 0, pitch: 0 };
    const size = Math.hypot(e.roll, e.pitch);
    const k = size < dead ? 0 : Math.min(cap, (size - dead) / full) / size;
    r.input.stickX = -e.roll * k;
    r.input.stickY = -e.pitch * k;
  };
}

const careful = (): ((r: Run) => void) => pilot(0.4, 2, 8, 0.8);
const slow = (): ((r: Run) => void) => pilot(1.5, 8, 20, 0.4);

/** Flies the whole stage; returns the stars, 0 for a burn-up. */
function fly(seed: number, make?: () => (r: Run) => void): Stars {
  const r = new Run(seeded(seed));
  r.run(REENTRY.fadeTo + 1, make?.());
  return r.events('complete')[0]?.e.stars ?? 0;
}

/** How many of `n` seeded runs end with each star count. */
function tally(n: number, make?: () => (r: Run) => void): number[] {
  const counts = [0, 0, 0, 0];
  for (let seed = 1; seed <= n; seed++) counts[fly(seed, make)]! += 1;
  return counts;
}

describe('intensity', () => {
  it('is 0 before the glow, builds to full at the peak, holds, and fades to 0 at the end', () => {
    expect(intensityAt(0)).toBe(0);
    expect(intensityAt(REENTRY.glowFrom)).toBe(0);
    const mid = (REENTRY.glowFrom + REENTRY.peakFrom) / 2;
    expect(intensityAt(mid)).toBeCloseTo(0.5, 5);
    expect(intensityAt(mid - 2)).toBeLessThan(intensityAt(mid));
    expect(intensityAt(REENTRY.peakFrom)).toBe(1);
    expect(intensityAt((REENTRY.peakFrom + REENTRY.peakTo) / 2)).toBe(1);
    expect(intensityAt(REENTRY.peakTo)).toBe(1);
    expect(intensityAt(REENTRY.peakTo + 5)).toBeLessThan(1);
    expect(intensityAt(REENTRY.peakTo + 10)).toBeLessThan(intensityAt(REENTRY.peakTo + 5));
    expect(intensityAt(REENTRY.fadeTo)).toBe(0);
  });

  it('puts the peak in the middle of a stage of about 40 s', () => {
    expect(REENTRY.fadeTo).toBeGreaterThanOrEqual(35);
    expect(REENTRY.fadeTo).toBeLessThanOrEqual(45);
    const centre = (REENTRY.peakFrom + REENTRY.peakTo) / 2;
    expect(centre / REENTRY.fadeTo).toBeGreaterThan(0.4);
    expect(centre / REENTRY.fadeTo).toBeLessThan(0.6);
  });
});

describe('shoves', () => {
  it('leave the attitude alone before the glow', () => {
    const r = new Run().run(REENTRY.glowFrom - 0.1);
    expect(errorOf(r.s)).toBe(0);
  });

  it('push the attitude away on both axes, harder with the intensity', () => {
    /** The error one shove at a fixed rate and direction leaves after starting at stage time `from`. */
    const shoveFrom = (from: number): ReentryState => {
      const r = new Run(() => 0.125);
      r.s.t = from;
      r.s.gapLeft = 0;
      r.run(REENTRY.shoveSeconds[0] + 0.5);
      return r.s;
    };
    const early = shoveFrom(REENTRY.glowFrom + 1);
    const peak = shoveFrom(REENTRY.peakFrom);
    expect(errorOf(early)).toBeGreaterThan(0);
    expect(errorOf(peak)).toBeGreaterThan(5 * errorOf(early));
    expect(Math.abs(peak.roll)).toBeGreaterThan(1);
    expect(Math.abs(peak.pitch)).toBeGreaterThan(1);
  });

  it('come in different directions', () => {
    const r = new Run(seeded(3));
    const angles = new Set<number>();
    r.run(REENTRY.fadeTo - 1, (run) => {
      if (run.s.shove) angles.add(Math.round((Math.atan2(run.s.shove.pitch, run.s.shove.roll) * 180) / Math.PI));
      hold(run);
    });
    expect(angles.size).toBeGreaterThanOrEqual(5);
  });
});

describe('steering', () => {
  it.each([
    [1, 0, 1, 0],
    [-1, 0, -1, 0],
    [0, 1, 0, 1],
    [0, -1, 0, -1],
  ] as const)('stick (%i, %i) rolls by %i and pitches by %i times the stick rate', (stickX, stickY, roll, pitch) => {
    const r = new Run();
    r.input.stickX = stickX;
    r.input.stickY = stickY;
    r.run(1);
    expect(r.s.roll).toBeCloseTo(roll * REENTRY.stickRate, 3);
    expect(r.s.pitch).toBeCloseTo(pitch * REENTRY.stickRate, 3);
  });

  it('flies as an RC pilot expects: stick right rolls the right side down, pushed forward lowers the nose, pulled back raises it', () => {
    const turned = (stickX: number, stickY: number): ReturnType<typeof attitudeOf> => {
      const r = new Run();
      r.input.stickX = stickX;
      r.input.stickY = stickY;
      return attitudeOf(r.run(1).s);
    };
    expect(turned(1, 0).right.y).toBeLessThan(-0.1);
    expect(turned(-1, 0).right.y).toBeGreaterThan(0.1);
    expect(turned(0, 1).nose.y).toBeLessThan(-0.1);
    expect(turned(0, -1).nose.y).toBeGreaterThan(0.1);
    expect(turned(0, -1).nose.z).toBeLessThan(-0.9);
  });

  it('draws the safe attitude belly down with the nose towards -Z, and keeps the axes square', () => {
    const a = attitudeOf(createReentry());
    expect(a.nose.x + 0).toBe(0);
    expect(a.nose.y + 0).toBe(0);
    expect(a.nose.z).toBe(-1);
    expect(a.belly.y).toBe(-1);
    expect(a.right.x).toBe(1);
    const s = createReentry();
    s.roll = 25;
    s.pitch = -15;
    const b = attitudeOf(s);
    const dot = (p: Point, q: Point): number => p.x * q.x + p.y * q.y + p.z * q.z;
    expect(dot(b.nose, b.right)).toBeCloseTo(0, 10);
    expect(dot(b.nose, b.belly)).toBeCloseTo(0, 10);
    expect(dot(b.right, b.belly)).toBeCloseTo(0, 10);
    expect(Math.acos(-b.belly.y) * (180 / Math.PI)).toBeCloseTo(Math.acos(Math.cos((25 * Math.PI) / 180) * Math.cos((15 * Math.PI) / 180)) * (180 / Math.PI), 6);
  });

  it('turns the ship back to the safe attitude', () => {
    const r = new Run();
    r.s.roll = 10;
    r.s.pitch = -5;
    r.run(10, careful());
    expect(errorOf(r.s)).toBeLessThan(3);
  });

  it('never lets the error exceed the largest', () => {
    const r = new Run();
    r.input.stickX = 1;
    r.run(REENTRY.glowFrom + 2);
    expect(errorOf(r.s)).toBeCloseTo(REENTRY.maxError, 5);
  });
});

describe('heat', () => {
  it('stays cold before the glow', () => {
    expect(new Run().run(REENTRY.glowFrom - 0.1).s.heat).toBe(0);
  });

  it('warms a perfectly held ship to about a third of the bar at the peak, and cools it towards the end', () => {
    const r = new Run();
    let peakHeat = 0;
    r.run(REENTRY.peakTo, hold);
    peakHeat = r.s.heat;
    r.run(REENTRY.fadeTo - REENTRY.peakTo - 0.1, hold);
    expect(r.s.maxHeat).toBeGreaterThan(0.25);
    expect(r.s.maxHeat).toBeLessThan(0.4);
    expect(peakHeat).toBeGreaterThan(0.25);
    expect(r.s.heat).toBeLessThan(r.s.maxHeat - 0.08);
  });

  it('rises slowly with a small error and quickly with a large one', () => {
    const rise = (error: number): number => {
      const r = new Run();
      r.s.t = REENTRY.peakFrom;
      r.s.heat = 0.3;
      r.run(1, (run) => {
        run.s.roll = error;
        run.s.pitch = 0;
      });
      return r.s.heat - 0.3;
    };
    expect(rise(0)).toBeGreaterThan(0);
    expect(rise(0)).toBeLessThan(0.02);
    expect(rise(REENTRY.limit / 2)).toBeLessThan(0.05);
    expect(rise(REENTRY.limit)).toBeGreaterThan(0.1);
    expect(rise(REENTRY.limit * 1.5)).toBeGreaterThan(2 * rise(REENTRY.limit / 2) + 0.15);
  });

  it('falls back slowly when the ship is well aligned and the intensity is low', () => {
    const r = new Run();
    r.s.t = REENTRY.fadeTo - 6;
    r.s.heat = 0.6;
    r.run(4, hold);
    expect(r.s.heat).toBeLessThan(0.55);
    expect(r.s.heat).toBeGreaterThan(0.3);
  });
});

describe('warning', () => {
  it('says the ship is hot at the threshold, at most every few seconds', () => {
    const r = new Run();
    r.s.t = REENTRY.peakFrom;
    r.s.heat = REENTRY.hotHeat - 0.05;
    const tilted = (run: Run): void => {
      run.s.roll = REENTRY.limit * 0.95;
      run.s.pitch = 0;
      run.s.heat = Math.min(run.s.heat, 0.95);
    };
    r.run(REENTRY.hotEvery * 2 + 1.5, tilted);
    const hot = r.events('hot');
    expect(hot.length).toBe(3);
    expect(hot[0]?.t).toBeLessThan(REENTRY.peakFrom + 1);
    expect(hot[1]!.t - hot[0]!.t).toBeCloseTo(REENTRY.hotEvery, 1);
  });

  it('stays silent below the threshold', () => {
    const r = new Run();
    r.run(REENTRY.fadeTo + 1, hold);
    expect(r.events('hot')).toEqual([]);
  });
});

describe('endings', () => {
  it('burns the ship up at full heat and stops', () => {
    const r = new Run();
    r.s.t = REENTRY.peakFrom;
    r.run(20, (run) => {
      run.s.roll = REENTRY.limit * 2;
      run.s.pitch = 0;
    });
    expect(r.s.phase).toBe('burnedUp');
    expect(r.s.heat).toBe(1);
    expect(r.events('burnup').length).toBe(1);
    expect(r.events('complete')).toEqual([]);
    expect(stepReentry(r.s, DT, r.input, r.random)).toEqual([]);
  });

  it('completes when the intensity has faded', () => {
    const r = new Run().run(REENTRY.fadeTo + 1, hold);
    expect(r.s.phase).toBe('complete');
    expect(r.events('complete')[0]?.t).toBeCloseTo(REENTRY.fadeTo, 1);
  });

  it.each([
    [0.45, 3],
    [REENTRY.threeStarHeat + 0.01, 2],
    [0.75, 2],
    [REENTRY.twoStarHeat + 0.01, 1],
    [0.97, 1],
  ] as const)('rates a highest heat of %f with %i stars', (maxHeat, stars) => {
    const r = new Run();
    r.s.t = REENTRY.fadeTo - 0.5;
    r.s.maxHeat = maxHeat;
    r.run(1, hold);
    expect(r.events('complete')[0]?.e.stars).toBe(stars);
    expect(r.s.stars).toBe(stars);
  });
});

describe('pilots', () => {
  const N = 200;

  it('burns up in most runs with no stick at all', () => {
    const counts = tally(N);
    expect(counts[0]).toBeGreaterThan(0.8 * N);
    expect(counts[3]).toBeLessThan(0.05 * N);
  });

  it('gives a careful pilot 3 stars nearly always', () => {
    expect(tally(N, careful)[3]).toBeGreaterThanOrEqual(0.97 * N);
  });

  it('lets a slow pilot survive with 1 or 2 stars mostly', () => {
    const counts = tally(N, slow);
    expect(counts[0]).toBeLessThanOrEqual(0.02 * N);
    expect(counts[1]! + counts[2]!).toBeGreaterThan(0.8 * N);
  });
});
