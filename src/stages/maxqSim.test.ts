import { describe, expect, it } from 'vitest';
import { MAXQ } from '../tuning.ts';
import type { InputState } from '../types.ts';
import { createMaxq, densityAt, type MaxqEvent, type MaxqState, pathFrame, pressureAt, speedFor, starsOf, stepMaxq } from './maxqSim.ts';

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

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** A pilot: sets the input before each step from the state and the previous step's events. */
type Pilot = (r: Run) => void;

/** A run with its input, clock and every event so far with the time it happened. */
class Run {
  readonly s: MaxqState;
  readonly input: InputState = { throttle: 1, stickX: 0, stickY: 0, armed: true };
  readonly log: { t: number; e: MaxqEvent }[] = [];
  last: MaxqEvent[] = [];

  constructor(seed = 1) {
    this.s = createMaxq(seeded(seed));
  }

  /** Steps for `seconds`, calling `pilot` before every step; stops early at an ending. */
  run(seconds: number, pilot?: Pilot): this {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      pilot?.(this);
      this.last = stepMaxq(this.s, DT, this.input);
      for (const e of this.last) this.log.push({ t: this.s.t, e });
      if (this.s.phase !== 'flying') break;
    }
    return this;
  }

  /** Runs to an ending. */
  finish(pilot?: Pilot): this {
    return this.run(300, pilot);
  }

  kinds(): string[] {
    return this.log.map(({ e }) => e.kind);
  }

  first(kind: MaxqEvent['kind']): { t: number; e: MaxqEvent } | undefined {
    return this.log.find(({ e }) => e.kind === kind);
  }
}

/** Eases to a band target `react` seconds after `trigger`, and back to full `react` seconds after `full`, at a stick's pace. */
function throttler(random: () => number, trigger: 'ease' | 'overload', react: readonly [number, number]): Pilot {
  const target = lerp(0.48, 0.62, random());
  let easeAt = Infinity;
  let fullAt = Infinity;
  let want = 1;
  return (r) => {
    for (const e of r.last) {
      if (e.kind === trigger && easeAt === Infinity) easeAt = r.s.t + lerp(react[0], react[1], random());
      if (e.kind === 'full') fullAt = r.s.t + lerp(1.5, 3.5, random());
    }
    if (r.s.t >= fullAt) want = 1;
    else if (r.s.t >= easeAt) want = target;
    const rate = 1.5 * DT;
    r.input.throttle += Math.max(-rate, Math.min(rate, want - r.input.throttle));
  };
}

/** Steers calmly towards the next ring as seen a reaction time ago, with a gentle gain and a capped stick. */
function steerer(random: () => number): Pilot {
  const react = lerp(0.3, 0.6, random());
  const gain = lerp(1 / 30, 1 / 18, random());
  const most = lerp(0.45, 0.7, random());
  const seen: [number, number, number][] = [];
  const stick = (v: number): number => Math.max(-most, Math.min(most, Math.abs(v) < 3 ? 0 : v * gain));
  return (r) => {
    seen.push([r.s.x, r.s.y, r.s.next]);
    const [x, y, n] = seen[Math.max(0, seen.length - 1 - Math.round(react / DT))] ?? [0, 0, 0];
    const ring = r.s.rings[n] ?? r.s.rings[r.s.next];
    if (!ring) return;
    r.input.stickX = stick(ring.x - x);
    r.input.stickY = -stick(ring.y - y);
  };
}

const both =
  (...pilots: Pilot[]): Pilot =>
  (r) => {
    for (const p of pilots) p(r);
  };

/** The seeded pilot models: each takes a seed for its own habits. */
const PILOTS = {
  nothing: (): Pilot => () => {},
  careful: (random: () => number): Pilot => both(throttler(random, 'ease', [2.5, 4.5]), steerer(random)),
  late: (random: () => number): Pilot => both(throttler(random, 'overload', [0, 1.2]), steerer(random)),
  ignorer: (random: () => number): Pilot => throttler(random, 'ease', [2.5, 4.5]),
  slow: (random: () => number): Pilot => both((r) => (r.input.throttle = 0.45), steerer(random)),
};

/** Star counts 0 to 3 over `n` seeded runs of `pilot`; 0 counts break-ups. */
function stats(pilot: keyof typeof PILOTS, n = 100): number[] {
  const stars = [0, 0, 0, 0];
  for (let seed = 1; seed <= n; seed++) {
    const r = new Run(seed).finish(PILOTS[pilot](seeded(seed * 7919 + 1)));
    stars[r.s.phase === 'complete' ? r.s.stars : 0]! += 1;
  }
  return stars;
}

describe('air pressure', () => {
  it('peaks about a third of the way in and is red at full throttle only around the middle', () => {
    const red: number[] = [];
    for (let u = 0; u <= 1; u += 0.005) if (pressureAt(u, speedFor(1)) >= MAXQ.red) red.push(u);
    expect(red.length).toBeGreaterThan(0);
    expect(Math.min(...red)).toBeGreaterThan(0.15);
    expect(Math.max(...red)).toBeLessThan(0.7);
    expect(Math.min(...red)).toBeLessThan(MAXQ.peakAt);
    expect(Math.max(...red)).toBeGreaterThan(MAXQ.peakAt);
    expect(densityAt(MAXQ.peakAt)).toBe(MAXQ.densityPeak);
    expect(MAXQ.peakAt).toBeGreaterThan(0.25);
    expect(MAXQ.peakAt).toBeLessThan(0.45);
  });

  it('is never red anywhere with the throttle inside the band', () => {
    for (let u = 0; u <= 1; u += 0.002) expect(pressureAt(u, speedFor(MAXQ.bandTo))).toBeLessThan(MAXQ.red - 0.05);
  });

  it('rises with speed', () => {
    expect(pressureAt(MAXQ.peakAt, speedFor(1))).toBeGreaterThan(pressureAt(MAXQ.peakAt, speedFor(0.5)));
    expect(speedFor(0)).toBeGreaterThan(0);
  });

  it('asks to ease before the red at full throttle and to go full once full throttle is safe again', () => {
    const r = new Run().finish();
    const ease = r.first('ease');
    const overload = r.first('overload');
    expect(ease).toBeDefined();
    expect(overload).toBeDefined();
    expect(r.kinds().slice(0, 1)).toEqual(['intro']);
    expect(ease!.t).toBeGreaterThan(3.5);
    expect(overload!.t - MAXQ.overloadAfter - ease!.t).toBeGreaterThan(5);

    const c = new Run().finish(PILOTS.careful(seeded(5)));
    const full = c.first('full');
    expect(full).toBeDefined();
    expect(c.kinds().filter((k) => k === 'ease' || k === 'full')).toEqual(['ease', 'full']);
    expect(c.s.stress).toBe(0);
  });

  it('stays out of the red when the throttle sits in the band from the start, and after the full cue at full throttle', () => {
    const r = new Run();
    r.input.throttle = MAXQ.bandTo;
    let peak = 0;
    r.finish((run) => {
      if (run.last.some((e) => e.kind === 'full')) run.input.throttle = 1;
      peak = Math.max(peak, run.s.pressure);
    });
    expect(r.s.phase).toBe('complete');
    expect(r.s.stress).toBe(0);
    expect(peak).toBeLessThan(MAXQ.red);
  });
});

describe('stress', () => {
  it('breaks the rocket up when nobody touches anything', () => {
    const r = new Run().finish();
    expect(r.s.phase).toBe('broken');
    expect(r.kinds().at(-1)).toBe('breakup');
    expect(r.s.stress).toBeCloseTo(MAXQ.stressLimit, 1);
    expect(r.kinds()).toContain('overload');
  });

  it('warns after a second in the red and repeats while the spell lasts', () => {
    const r = new Run().finish();
    const times = r.log.filter(({ e }) => e.kind === 'overload').map(({ t }) => t);
    expect(times.length).toBe(2);
    expect(times[1]! - times[0]!).toBeCloseTo(MAXQ.overloadRepeat, 1);
    const redFrom = times[0]! - MAXQ.overloadAfter;
    expect(r.first('breakup')!.t - redFrom).toBeCloseTo(MAXQ.stressLimit, 1);
  });

  it('adds up the time in the red over separate spells', () => {
    const r = new Run();
    while (r.s.stress < 2) r.run(DT);
    r.input.throttle = 0.5;
    expect(r.s.phase).toBe('flying');
    r.run(2);
    expect(r.s.spell).toBe(0);
    const first = r.s.stress;
    expect(first).toBeGreaterThan(2);
    expect(first).toBeLessThan(2.5);
    r.input.throttle = 1;
    r.finish();
    expect(r.s.phase).toBe('broken');
    expect(r.s.stress).toBeCloseTo(MAXQ.stressLimit, 1);
  });
});

describe('rings', () => {
  it('lays the rings along the path within reach of each other', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { rings } = createMaxq(seeded(seed));
      expect(rings.length).toBe(MAXQ.rings);
      expect(rings.at(-1)!.s).toBeCloseTo(MAXQ.length);
      let x = 0;
      let y = 0;
      for (const ring of rings) {
        expect(Math.hypot(ring.x - x, ring.y - y)).toBeLessThanOrEqual(MAXQ.ringStep[1] + 1e-9);
        expect(Math.hypot(ring.x, ring.y)).toBeLessThanOrEqual(MAXQ.ringSpread + MAXQ.ringStep[1]);
        x = ring.x;
        y = ring.y;
      }
    }
  });

  it('moves the rocket right on screen with the stick right, and down on screen with the stick forward like an elevator', () => {
    const r = new Run();
    r.input.stickX = 1;
    r.run(1);
    expect(r.s.x).toBeGreaterThan(10);
    expect(Math.abs(r.s.y)).toBeLessThan(1e-9);
    r.input.stickX = 0;
    r.input.stickY = 1;
    const x = r.s.x;
    r.run(1);
    expect(r.s.y).toBeLessThan(-8);
    expect(r.s.x - x).toBeGreaterThan(0);
    const y = r.s.y;
    r.input.stickY = -1;
    r.run(1.5);
    expect(r.s.y - y).toBeGreaterThan(15);
    const f = pathFrame(0);
    expect(f.up[1]).toBeGreaterThan(0);
    expect(f.up[0] * f.tangent[0] + f.up[1] * f.tangent[1] + f.up[2] * f.tangent[2]).toBeCloseTo(0);
  });

  it('counts a ring flown through and misses one flown past', () => {
    const r = new Run();
    r.s.rings[0] = { s: 200, x: 25, y: 0, hit: undefined };
    r.s.rings[1] = { s: 400, x: -40, y: 0, hit: undefined };
    r.run(2.2, (run) => (run.input.stickX = run.s.x < 25 ? 1 : 0));
    expect(r.log.filter(({ e }) => e.kind === 'ring').map(({ e }) => e)).toEqual([{ kind: 'ring', index: 0, hit: true }]);
    expect(r.s.hits).toBe(1);
    r.input.stickX = 0;
    r.run(2.2);
    expect(r.log.filter(({ e }) => e.kind === 'ring').map(({ e }) => e).at(-1)).toEqual({ kind: 'ring', index: 1, hit: false });
    expect(r.s.hits).toBe(1);
    expect(r.s.rings[1]!.hit).toBe(false);
  });

  it('ends with the last ring', () => {
    const r = new Run().finish(PILOTS.careful(seeded(3)));
    expect(r.s.phase).toBe('complete');
    expect(r.kinds().slice(-2)).toEqual(['ring', 'complete']);
    expect(r.s.next).toBe(MAXQ.rings);
  });
});

describe('stars', () => {
  const done = (hits: number, stress: number, t: number): MaxqState => ({ ...createMaxq(seeded(1)), hits, stress, t });

  it('gives each rating by its thresholds', () => {
    expect(starsOf(done(MAXQ.rings, 0, 40))).toBe(3);
    expect(starsOf(done(MAXQ.rings - MAXQ.missesFor3, MAXQ.redFor3, 40))).toBe(3);
    expect(starsOf(done(MAXQ.rings - MAXQ.missesFor3 - 1, 0, 40))).toBe(2);
    expect(starsOf(done(MAXQ.rings, MAXQ.redFor3 + 0.1, 40))).toBe(2);
    expect(starsOf(done(MAXQ.rings, 0, MAXQ.timeLimit + 0.1))).toBe(2);
    expect(starsOf(done(MAXQ.hitsFor2, MAXQ.redFor2, 40))).toBe(2);
    expect(starsOf(done(MAXQ.hitsFor2 - 1, 0, 40))).toBe(1);
    expect(starsOf(done(MAXQ.rings, MAXQ.redFor2 + 0.1, 40))).toBe(1);
  });

  it('caps a slow finish at 2 stars', () => {
    const r = new Run(4).finish(PILOTS.slow(seeded(4)));
    expect(r.s.phase).toBe('complete');
    expect(r.s.hits).toBe(MAXQ.rings);
    expect(r.s.stress).toBe(0);
    expect(r.s.t).toBeGreaterThan(MAXQ.timeLimit);
    expect(r.s.stars).toBe(2);
  });
});

describe('pilots', () => {
  it('lasts about 45 seconds at a sensible pace', () => {
    const r = new Run(2).finish(PILOTS.careful(seeded(2)));
    expect(r.s.t).toBeGreaterThan(38);
    expect(r.s.t).toBeLessThan(MAXQ.timeLimit);
  });

  it('a careful pilot gets 3 stars nearly always', () => {
    expect(stats('careful')[3]).toBeGreaterThanOrEqual(95);
  });

  it('a pilot who eases late but in time gets 2 stars', () => {
    expect(stats('late')).toEqual([0, 0, 100, 0]);
  });

  it('a pilot who ignores the rings but manages the throttle finishes with 1 or 2', () => {
    const s = stats('ignorer');
    expect(s[0]).toBe(0);
    expect(s[3]).toBe(0);
    expect(s[1]! + s[2]!).toBe(100);
  });

  it('nobody touching anything always breaks up', () => {
    expect(stats('nothing')[0]).toBe(100);
  });
});
