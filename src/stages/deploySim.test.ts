import { describe, expect, it } from 'vitest';
import { DEPLOY } from '../tuning.ts';
import type { InputState } from '../types.ts';
import { createDeploy, type DeployEvent, type DeployState, goodCount, screenTiltOf, starsFor, stepDeploy, stickTurn, tiltOf, windowShare } from './deploySim.ts';

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
  readonly random: () => number;
  readonly s: DeployState;
  readonly input: InputState = { throttle: 0, stickX: 0, stickY: 0, armed: false };
  confirm = false;
  yaw = 0;
  t = 0;
  readonly log: { t: number; e: DeployEvent }[] = [];

  constructor(seed = 1) {
    this.random = seeded(seed);
    this.s = createDeploy(this.random);
  }

  /** Steps for `seconds`, calling `pilot` before every step; a confirm lasts one step. */
  run(seconds: number, pilot?: (r: Run) => void): this {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      pilot?.(this);
      this.t += DT;
      for (const e of stepDeploy(this.s, DT, this.input, this.confirm, this.yaw, this.random)) this.log.push({ t: this.t, e });
      this.confirm = false;
    }
    return this;
  }

  /** Runs to the end of the intro. */
  intro(): this {
    return this.run(DEPLOY.introSeconds + DT);
  }

  /** Steps until the run is done or `limit` seconds pass. */
  finish(pilot?: (r: Run) => void, limit = 120): this {
    for (let i = 0; i < limit / DT && this.s.phase !== 'done'; i++) this.run(DT, pilot);
    return this;
  }

  /** Flips the switch on the next step. */
  flip(): this {
    this.confirm = true;
    return this.run(DT);
  }

  events(kind: DeployEvent['kind']): DeployEvent[] {
    return this.log.filter((l) => l.e.kind === kind).map((l) => l.e);
  }

  complete(): Extract<DeployEvent, { kind: 'complete' }> | undefined {
    return this.events('complete')[0] as Extract<DeployEvent, { kind: 'complete' }> | undefined;
  }

  /** Clears the drift and the kicks so only the stick turns the ship. */
  calm(): this {
    this.s.driftRate = 0;
    this.s.kickX = 0;
    this.s.kickY = 0;
    return this;
  }
}

/** Steers back towards steady, the screen's way, as a child would: full stick far out, gentler near steady. */
function steer(r: Run): void {
  const { right, away } = screenTiltOf(r.s, r.yaw);
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  r.input.stickX = clamp(-right / 2);
  r.input.stickY = clamp(-away / 2);
}

/** Never steers and flips as fast as the reload allows. */
const hasty = (r: Run): void => {
  r.input.stickX = 0;
  r.input.stickY = 0;
  r.confirm = r.s.phase === 'window' && r.s.reload <= 0;
};

/** Steers back towards steady on what it saw `REACTION` seconds ago, leaves small errors alone, and flips once the ship has looked steady for a moment. */
function careful(reaction = REACTION, gain = 3, settle = 1): (r: Run) => void {
  const seen: { right: number; away: number }[] = [];
  let steady = 0;
  return (r) => {
    seen.push(screenTiltOf(r.s, r.yaw));
    const old = seen.length > reaction / DT ? seen.shift() : undefined;
    const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
    const size = old ? Math.hypot(old.right, old.away) : 0;
    r.input.stickX = old && size > 1.5 ? clamp(-old.right / gain) : 0;
    r.input.stickY = old && size > 1.5 ? clamp(-old.away / gain) : 0;
    steady = size <= DEPLOY.releaseLimit / 2 ? steady + DT : 0;
    r.confirm = r.s.phase === 'window' && r.s.reload <= 0 && steady >= settle;
  };
}
const REACTION = 0.6;

describe('deploy simulation', () => {
  it('holds the ship steady and ignores flips during the intro', () => {
    const r = new Run();
    r.input.stickX = 1;
    r.confirm = true;
    r.run(DEPLOY.introSeconds - 0.1, (x) => (x.confirm = true));
    expect(r.s.phase).toBe('intro');
    expect(tiltOf(r.s)).toBe(0);
    expect(r.events('release')).toHaveLength(0);
    r.run(0.2);
    expect(r.events('open')).toHaveLength(1);
    expect(r.s.phase).toBe('window');
  });

  it('drifts slowly by itself once the window opens, sideways on screen by `depthShare`', () => {
    const tilts = Array.from({ length: 20 }, (_, i) => {
      const r = new Run(i + 1).intro().run(4);
      expect(Math.abs(r.s.y)).toBeLessThanOrEqual(Math.abs(r.s.x) * DEPLOY.depthShare * 4 + 1e-9);
      return tiltOf(r.s);
    });
    expect(Math.max(...tilts)).toBeLessThanOrEqual(4 * DEPLOY.driftRate[1] + 1e-9);
    expect(tilts.filter((t) => t > 0.5).length).toBeGreaterThan(10);
  });

  it('kicks the ship by about `kick` degrees on every release', () => {
    const r = new Run(5).intro().calm();
    r.flip();
    r.run(3);
    expect(tiltOf(r.s)).toBeGreaterThan(DEPLOY.kick * 0.97);
    expect(tiltOf(r.s)).toBeLessThan(DEPLOY.kick * 1.03);
  });

  it('turns the ship the way the stick points on screen, whatever the camera swing', () => {
    for (const yaw of [0, 0.3, -0.5, Math.PI / 2]) {
      const right = new Run(7).intro().calm();
      right.yaw = yaw;
      right.input.stickX = 1;
      right.run(1);
      expect(screenTiltOf(right.s, yaw).right).toBeCloseTo(DEPLOY.stickRate, 5);
      expect(screenTiltOf(right.s, yaw).away).toBeCloseTo(0, 5);
      const up = new Run(7).intro().calm();
      up.yaw = yaw;
      up.input.stickY = 1;
      up.run(1);
      expect(screenTiltOf(up.s, yaw).right).toBeCloseTo(0, 5);
      expect(screenTiltOf(up.s, yaw).away).toBeCloseTo(DEPLOY.stickRate, 5);
    }
    const t = stickTurn(1, 0, 0);
    expect([t.x, t.y]).toEqual([1, 0]);
  });

  it('splits the error into screen parts in the stick\'s frame whose length is the whole error', () => {
    const r = new Run(11).intro();
    for (const yaw of [0, 0.4, -1.1]) {
      r.s.x = 3;
      r.s.y = -4;
      const p = screenTiltOf(r.s, yaw);
      expect(Math.hypot(p.right, p.away)).toBeCloseTo(tiltOf(r.s), 9);
      for (const [sx, sy] of [
        [1, 0],
        [0, 1],
        [0.6, -0.8],
      ] as const) {
        const t = stickTurn(sx, sy, yaw);
        const turned = screenTiltOf({ ...r.s, x: t.x, y: t.y }, yaw);
        expect(turned.right).toBeCloseTo(sx, 9);
        expect(turned.away).toBeCloseTo(sy, 9);
      }
    }
  });

  it('counts a release good exactly when the shown error is inside the release limit', () => {
    for (const [x, good] of [
      [DEPLOY.releaseLimit, true],
      [DEPLOY.releaseLimit + 1e-6, false],
    ] as const) {
      const r = new Run().intro().calm();
      r.s.x = 0;
      r.s.y = -x;
      r.input.stickX = 1;
      r.flip();
      expect(r.events('release')).toEqual([{ kind: 'release', index: 0, good }]);
    }
  });

  it('never lets the error exceed `maxTilt`', () => {
    const r = new Run().intro();
    r.input.stickX = 1;
    r.run(10);
    expect(tiltOf(r.s)).toBeCloseTo(DEPLOY.maxTilt, 5);
  });

  it('releases a satellite well inside the limit', () => {
    const r = new Run().intro().calm();
    r.flip();
    expect(r.events('release')).toEqual([{ kind: 'release', index: 0, good: true }]);
    expect(goodCount(r.s)).toBe(1);
  });

  it('sends a satellite tumbling outside the limit', () => {
    const r = new Run().intro().calm();
    r.s.x = DEPLOY.releaseLimit + 0.5;
    r.flip();
    expect(r.events('release')).toEqual([{ kind: 'release', index: 0, good: false }]);
    expect(r.s.satellites[0]).toBe('bad');
  });

  it('ignores a flip during the reload and takes one after it', () => {
    const r = new Run().intro().calm();
    r.flip();
    r.run(DEPLOY.reloadSeconds - 0.1);
    r.flip();
    expect(r.events('release')).toHaveLength(1);
    r.run(0.2);
    r.flip();
    expect(r.events('release')).toHaveLength(2);
  });

  it('loses the satellites still aboard when the window closes', () => {
    const r = new Run().intro().calm();
    r.flip();
    r.run(DEPLOY.windowSeconds - 0.1);
    expect(r.s.phase).toBe('window');
    expect(windowShare(r.s)).toBeLessThan(0.01);
    r.run(0.2);
    expect(r.events('closed')).toEqual([{ kind: 'closed', lost: 4 }]);
    expect(r.s.satellites).toEqual(['good', 'lost', 'lost', 'lost', 'lost']);
    r.flip();
    expect(r.events('release')).toHaveLength(1);
    r.finish();
    expect(r.complete()).toEqual({ kind: 'complete', stars: 1, good: 1 });
  });

  it('ends `finishSeconds` after the last release', () => {
    const r = new Run().intro();
    for (let i = 0; i < DEPLOY.satellites; i++) {
      r.calm();
      r.s.x = 0;
      r.s.y = 0;
      r.flip();
      r.run(DEPLOY.reloadSeconds);
    }
    expect(r.s.phase).toBe('finish');
    const last = r.log.filter((l) => l.e.kind === 'release').at(-1)?.t ?? 0;
    r.finish();
    const done = r.log.find((l) => l.e.kind === 'complete')?.t ?? 0;
    expect(done - last).toBeCloseTo(DEPLOY.finishSeconds, 1);
    expect(r.complete()).toEqual({ kind: 'complete', stars: 3, good: 5 });
  });

  it('rates five good 3 stars, three or four 2, one or two 1, none 0', () => {
    expect([0, 1, 2, 3, 4, 5].map(starsFor)).toEqual([0, 1, 1, 2, 2, 3]);
    for (const [good, stars] of [
      [5, 3],
      [4, 2],
      [3, 2],
      [2, 1],
      [1, 1],
      [0, 0],
    ] as const) {
      const r = new Run().intro();
      for (let i = 0; i < DEPLOY.satellites; i++) {
        r.calm();
        r.s.x = i < good ? 0 : DEPLOY.releaseLimit + 1;
        r.s.y = 0;
        r.flip();
        r.run(DEPLOY.reloadSeconds);
      }
      r.finish();
      expect(r.complete()).toEqual({ kind: 'complete', stars, good });
    }
  });

  it('fails a pilot who never flips', () => {
    const r = new Run().intro().finish(steer);
    expect(r.events('closed')).toEqual([{ kind: 'closed', lost: 5 }]);
    expect(r.complete()?.stars).toBe(0);
  });
});

describe('deploy pilots', () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

  it('loses most satellites for a pilot who flips as fast as allowed without steering', () => {
    const goods = SEEDS.map((seed) => goodCount(new Run(seed).intro().finish(hasty).s));
    const hist = [0, 1, 2, 3, 4, 5].map((n) => goods.filter((g) => g === n).length);
    console.log(`hasty: good satellites 0..5 -> ${hist.join(' ')}`);
    expect(goods.every((g) => g <= 2)).toBe(true);
  });

  it('releases all five for a slow child: a second to react, gentle stick, two seconds of steady before each flip', () => {
    const results = SEEDS.map((seed) => {
      const r = new Run(seed).intro().finish(careful(1, 6, 2));
      return { good: goodCount(r.s), used: (r.log.filter((l) => l.e.kind === 'release').at(-1)?.t ?? Infinity) - DEPLOY.introSeconds };
    });
    const used = results.map((x) => x.used).sort((a, b) => a - b);
    console.log(`slow: all five ${results.filter((x) => x.good === 5).length}/${SEEDS.length}, window used median ${used[used.length >> 1]?.toFixed(1)} s, max ${used.at(-1)?.toFixed(1)} s of ${DEPLOY.windowSeconds}`);
    expect(results.every((x) => x.good === 5)).toBe(true);
    expect(used.at(-1) ?? Infinity).toBeLessThan(DEPLOY.windowSeconds * 0.8);
  });

  it('releases all five well inside the window for a careful pilot', () => {
    const results = SEEDS.map((seed) => {
      const r = new Run(seed).intro().finish(careful());
      const last = r.log.filter((l) => l.e.kind === 'release').at(-1)?.t ?? Infinity;
      return { good: goodCount(r.s), used: last - DEPLOY.introSeconds };
    });
    const used = results.map((x) => x.used).sort((a, b) => a - b);
    console.log(`careful: all five ${results.filter((x) => x.good === 5).length}/${SEEDS.length}, window used median ${used[used.length >> 1]?.toFixed(1)} s, max ${used.at(-1)?.toFixed(1)} s of ${DEPLOY.windowSeconds}`);
    expect(results.every((x) => x.good === 5)).toBe(true);
    expect(used.at(-1) ?? Infinity).toBeLessThan(DEPLOY.windowSeconds * 0.6);
  });
});
