import { describe, expect, it } from 'vitest';
import { STAGING } from '../tuning.ts';
import type { InputState, Stars } from '../types.ts';
import { createStaging, type StagingEvent, type StagingState, stepStaging, ZERO_AT } from './stagingSim.ts';

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

/** A run with its input, clock and every event so far with the time it happened. */
class Run {
  readonly s: StagingState = createStaging();
  readonly input: InputState = { throttle: 1, stickX: 0, stickY: 0, armed: false };
  /** Set by a pilot to flip the switch in the next step. */
  flip = false;
  t = 0;
  readonly log: { t: number; e: StagingEvent }[] = [];

  /** Steps for `seconds`, calling `pilot` before every step; stops early at an ending. */
  run(seconds: number, pilot?: (r: Run) => void): this {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      pilot?.(this);
      this.t += DT;
      const flip = this.flip;
      this.flip = false;
      for (const e of stepStaging(this.s, DT, this.input, flip)) this.log.push({ t: this.t, e });
      if (this.ended) break;
    }
    return this;
  }

  get ended(): boolean {
    return this.s.phase === 'failed' || this.s.phase === 'exploded' || this.s.phase === 'complete';
  }

  kinds(): string[] {
    return this.log.map(({ e }) => (e.kind === 'count' ? `count:${e.n}` : e.kind));
  }

  first(kind: StagingEvent['kind']): { t: number; e: StagingEvent } | undefined {
    return this.log.find(({ e }) => e.kind === kind);
  }

  /** The stage time of zero in the current count. */
  get zero(): number {
    return this.first('countPrompt')!.t + ZERO_AT - DT;
  }
}

/** Throttles down at once and runs to the count's prompt. */
function toCount(): Run {
  const r = new Run();
  r.input.throttle = 0;
  r.run(STAGING.promptSeconds + 0.1);
  expect(r.s.phase).toBe('count');
  return r;
}

/** A pilot that flips at `at` seconds from zero and then raises the throttle at `rate` per second after `delay`. */
function pilot(at: number, delay = 0.3, rate = 4): (r: Run) => void {
  let flipped = false;
  return (r) => {
    if (!flipped && r.s.phase === 'count' && r.first('countPrompt') && r.t + DT >= r.zero + at) {
      flipped = true;
      r.flip = true;
    }
    if (r.s.phase === 'fire' && r.s.fireT >= delay) r.input.throttle = Math.min(1, r.input.throttle + rate * DT);
  };
}

describe('throttle down', () => {
  it('waits for the throttle and repeats the prompt', () => {
    const r = new Run().run(STAGING.promptRepeat * 2 + 1);
    expect(r.s.phase).toBe('throttleDown');
    expect(r.kinds()).toEqual(['prompt', 'prompt', 'prompt']);
    r.input.throttle = 0.5;
    r.run(1);
    expect(r.s.phase).toBe('throttleDown');
    r.input.throttle = STAGING.throttleLow;
    r.run(STAGING.throttleLowHold - 0.1);
    r.input.throttle = 0.2;
    r.run(0.1);
    expect(r.s.phase).toBe('throttleDown');
    r.input.throttle = STAGING.throttleLow;
    r.run(STAGING.promptSeconds);
    expect(r.s.phase).toBe('count');
    expect(r.kinds().at(-1)).toBe('countPrompt');
  });

  it('lets the prompt finish before the count begins', () => {
    const r = new Run();
    r.input.throttle = 0;
    r.run(STAGING.promptSeconds - 0.1);
    expect(r.s.phase).toBe('throttleDown');
    r.run(0.2);
    expect(r.s.phase).toBe('count');
    expect(r.first('countPrompt')!.t).toBeCloseTo(STAGING.promptSeconds, 1);
  });
});

describe('count', () => {
  it('counts 3, 2, 1, 0 once a second after its prompt', () => {
    const r = toCount().run(ZERO_AT + 0.2);
    const counts = r.log.filter(({ e }) => e.kind === 'count');
    expect(counts.map(({ e }) => (e.kind === 'count' ? e.n : -1))).toEqual([3, 2, 1, 0]);
    expect(counts[0]!.t - r.first('countPrompt')!.t).toBeCloseTo(STAGING.countLead, 1);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!.t - counts[i - 1]!.t).toBeCloseTo(1, 1);
    expect(r.s.digit).toBe(0);
  });

  it('stops the count and asks again when the throttle comes up', () => {
    const r = toCount().run(STAGING.countLead + 1.5);
    r.input.throttle = STAGING.countThrottle + 0.05;
    r.run(0.1);
    expect(r.s.phase).toBe('throttleDown');
    expect(r.s.digit).toBeUndefined();
    expect(r.kinds().slice(-2)).toEqual(['countStopped', 'prompt']);
    r.input.throttle = 0;
    r.run(STAGING.promptSeconds + 0.1);
    expect(r.kinds().at(-1)).toBe('countPrompt');
  });

  it('separates when the flip and the throttle coming up arrive in the same step', () => {
    const r = toCount().run(ZERO_AT - 0.05);
    r.flip = true;
    r.input.throttle = 1;
    r.run(DT);
    expect(r.s.phase).toBe('fire');
    expect(r.kinds()).not.toContain('countStopped');
  });

  it('ignores a flip before the count begins and during its prompt', () => {
    const r = new Run();
    r.run(2, (q) => (q.flip = true));
    r.input.throttle = 0;
    r.run(STAGING.promptSeconds + STAGING.countLead, (q) => (q.flip = q.s.phase === 'throttleDown' || q.s.countT < STAGING.countLead - 2 * DT));
    expect(r.s.phase).toBe('count');
    expect(r.kinds()).not.toContain('separate');
    expect(r.kinds()).not.toContain('early');
    expect(r.s.error).toBeUndefined();
  });

  it('decides on the first flip of the count only, so flipping early and often explodes', () => {
    const r = toCount().run(STAGING.countLead + 0.1);
    r.run(4, (q) => (q.flip = true));
    expect(r.s.phase).toBe('exploded');
    expect(r.kinds().at(-1)).toBe('early');
  });
});

describe('timing', () => {
  const cases: [number, Stars][] = [
    [0, 3],
    [-0.3, 3],
    [0.3, 3],
    [-0.5, 2],
    [0.7, 2],
    [-1.1, 1],
    [1.0, 1],
    [1.5, 1],
  ];
  for (const [at, stars] of cases) {
    it(`gives ${stars} stars for a flip ${at} s from zero with a quick throttle`, () => {
      const r = toCount().run(20, pilot(at));
      expect(r.s.error).toBeCloseTo(at, 1);
      expect(r.s.phase).toBe('complete');
      expect(r.s.stars).toBe(stars);
      expect(r.kinds()).toContain('separate');
    });
  }

  it('explodes for a flip too far before zero', () => {
    const r = toCount().run(20, pilot(-STAGING.earlyLimit - 0.15));
    expect(r.s.phase).toBe('exploded');
    expect(r.kinds().at(-1)).toBe('early');
    expect(r.kinds()).not.toContain('separate');
  });

  it('fails when the flip has not come by the late limit', () => {
    const r = toCount().run(20);
    expect(r.s.phase).toBe('failed');
    expect(r.kinds().at(-1)).toBe('late');
    expect(r.first('late')!.t - r.zero).toBeCloseTo(STAGING.lateLimit, 1);
  });
});

describe('fire', () => {
  it('pulls away when the throttle comes up in time and opens the gap', () => {
    const r = toCount().run(20, pilot(0, 0.2));
    expect(r.s.phase).toBe('complete');
    expect(r.s.throttleT!).toBeLessThan(STAGING.quickThrottle);
    expect(r.s.gap).toBeGreaterThan(40);
    expect(r.first('complete')!.t - r.first('pullAway')!.t).toBeCloseTo(STAGING.pullSeconds, 1);
  });

  it('caps the stars at 2 when the throttle comes up slowly', () => {
    const r = toCount().run(20, pilot(0, STAGING.quickThrottle + 0.3));
    expect(r.s.phase).toBe('complete');
    expect(r.s.throttleT!).toBeGreaterThan(STAGING.quickThrottle);
    expect(r.s.stars).toBe(2);
  });

  it('sinks the ship back onto the booster when the throttle stays low', () => {
    const r = toCount();
    r.run(20, (q) => {
      pilot(0)(q);
      if (q.s.phase === 'fire') q.input.throttle = STAGING.fullThrottle - 0.1;
    });
    expect(r.s.phase).toBe('exploded');
    expect(r.kinds().at(-1)).toBe('weak');
    expect(r.first('weak')!.t - r.first('separate')!.t).toBeCloseTo(STAGING.throttleDeadline, 1);
    expect(r.s.gap).toBe(0);
  });

  it('opens a gap at the flip and closes it towards the deadline', () => {
    const s = createStaging();
    s.phase = 'fire';
    const input: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: false };
    stepStaging(s, STAGING.throttleDeadline / 2, input, false);
    expect(s.gap).toBeCloseTo(STAGING.hopHeight, 3);
    stepStaging(s, STAGING.throttleDeadline / 2 - 0.1, input, false);
    expect(s.gap).toBeLessThan(STAGING.hopHeight / 2);
  });
});

describe('a pilot who does nothing', () => {
  it('waits with the throttle up, prompting every few seconds', () => {
    const r = new Run().run(60);
    expect(r.s.phase).toBe('throttleDown');
    expect(r.kinds().filter((k) => k === 'prompt').length).toBe(Math.ceil(60 / STAGING.promptRepeat));
  });

  it('fails late with the throttle down and no flip', () => {
    const r = toCount().run(20);
    expect(r.s.phase).toBe('failed');
  });
});

/** Runs `n` seeded pilots; `make` builds a pilot from a random source. Returns the share of each star count. */
function statistics(n: number, make: (random: () => number) => (r: Run) => void): Record<Stars, number> {
  const out: Record<Stars, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let seed = 1; seed <= n; seed++) {
    const r = toCount().run(30, make(seeded(seed)));
    out[r.s.phase === 'complete' ? r.s.stars : 0]++;
  }
  for (const k of [0, 1, 2, 3] as const) out[k] /= n;
  return out;
}

describe('pilot models', () => {
  const N = 1000;
  const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

  it('a child reacting to zero after 0.3 to 0.7 s, throttle up after 0.4 to 1.2 s, mostly gets 2 or 3 stars', () => {
    const stats = statistics(N, (random) => pilot(lerp(0.3, 0.7, random()), lerp(0.4, 1.2, random()), lerp(2, 5, random())));
    console.log('reacting child', stats);
    expect(stats[2] + stats[3]).toBeGreaterThan(0.9);
    expect(stats[0]).toBe(0);
  });

  it('a child anticipating zero, scattered by 0.5 s either way, rarely fails', () => {
    const stats = statistics(N, (random) => {
      const g = (random() + random() + random() - 1.5) * 2 * 0.5;
      return pilot(g, lerp(0.4, 1.2, random()), lerp(2, 5, random()));
    });
    console.log('anticipating child', stats);
    expect(stats[0]).toBeLessThan(0.05);
  });

  it('a slow child reacting after 0.6 to 1.4 s with a slow keyboard throttle still mostly succeeds', () => {
    const stats = statistics(N, (random) => pilot(lerp(0.6, 1.4, random()), lerp(0.5, 1.5, random()), 0.7));
    console.log('slow child', stats);
    expect(stats[0]).toBeLessThan(0.1);
  });
});
