import { describe, expect, it } from 'vitest';
import { CATCH } from '../tuning.ts';
import type { InputState } from '../types.ts';
import { catchBoxHalfWidth, createCatchSim, inCatchBox, screenStick, settledSpeed, speedLight } from './boosterCatchSim.ts';
import type { CatchEvent, CatchGeometry, CatchSim, CatchState } from './boosterCatchSim.ts';

/** The world's measurements: Super Heavy and the Starbase tower and mount. */
const GEO: CatchGeometry = {
  catchY: 87,
  catchHalfWidth: 12.79,
  pinHeight: 61,
  radius: 4.5,
  height: 71,
  mountTop: 20,
  mountRadius: 11,
  arms: { pivotX: -13.5, length: 28, openSlope: Math.tan((32 * Math.PI) / 180), halfWidth: 0.8, halfHeight: 3.9 },
  footprint: { minX: -29, maxX: -12.4, halfZ: 7, top: 156 },
};
const DT = 1 / 60;

/** A deterministic random source in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pilot's wish in the world frame: stickX towards +X, stickY towards -Z. */
type Pilot = (s: CatchState) => Partial<InputState>;

interface Flight {
  sim: CatchSim;
  events: CatchEvent[];
  end: CatchEvent | undefined;
}

/** A camera yaw like the stage's: 0 high up, then swinging between the front and the side. */
const droneYaw = (s: CatchState): number =>
  s.y + GEO.pinHeight - GEO.catchY > CATCH.approachHeight ? 0 : (Math.PI / 4) * (1 - Math.cos(s.time * 0.22));

/** Flies `pilot`, handing the sim its wish as the screen-relative stick a player would give under `droneYaw`. */
function fly(pilot: Pilot, seed = 1, maxSeconds = 400): Flight {
  const sim = createCatchSim(GEO, seeded(seed));
  const events: CatchEvent[] = [];
  while (sim.state.phase === 'flying' && sim.state.time < maxSeconds) {
    const wish = { throttle: 0, stickX: 0, stickY: 0, armed: true, ...pilot(sim.state) };
    const yaw = droneYaw(sim.state);
    const screen = screenStick(wish.stickX, wish.stickY, -yaw);
    events.push(...sim.step(DT, { ...wish, ...screenStick(screen.stickX, screen.stickY, yaw) }));
  }
  return { sim, events, end: events.find((e) => e.type === 'caught' || e.type === 'crash') };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const heightAbove = (s: CatchState): number => s.y + GEO.pinHeight - GEO.catchY;

/** Holds the descent speed `want(h)` with the throttle, for pins h metres above the catch point. */
function throttleFor(s: CatchState, want: number): number {
  const base = CATCH.hoverThrottle * (1 - Math.sqrt(want / CATCH.fallSpeed));
  return clamp(base + 0.05 * (-s.vy - want), 0, 1);
}

/** Steers towards (tx, tz) at up to 5 m/s. */
function steerTo(s: CatchState, tx: number, tz: number): Partial<InputState> {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const d = Math.hypot(dx, dz);
  const speed = Math.min(5, d * 0.3);
  const vx = d > 0 ? (dx / d) * speed : 0;
  const vz = d > 0 ? (dz / d) * speed : 0;
  return { stickX: clamp((vx - s.vx) * 0.6, -1, 1), stickY: -clamp((vz - s.vz) * 0.6, -1, 1) };
}

/** A careful descent schedule ending at `final` m/s for the last 30 m. */
const schedule =
  (final: number) =>
  (h: number): number =>
    h > 300 ? 15 : h > 100 ? 8 : h > 30 ? 4 : final;

const careful =
  (tx = 0, tz = 0, final = 2): Pilot =>
  (s) => ({ throttle: throttleFor(s, schedule(final)(heightAbove(s))), ...steerTo(s, tx, tz) });

describe('screen-relative stick', () => {
  const close = (v: { stickX: number; stickY: number }, x: number, y: number): void => {
    expect(v.stickX).toBeCloseTo(x);
    expect(v.stickY).toBeCloseTo(y);
  };

  it('from the front, right is +X and up is -Z', () => {
    close(screenStick(1, 0, 0), 1, 0);
    close(screenStick(0, 1, 0), 0, 1);
  });

  it('from the +X side, right is -Z and up is -X', () => {
    close(screenStick(1, 0, Math.PI / 2), 0, 1);
    close(screenStick(0, 1, Math.PI / 2), -1, 0);
  });

  it('keeps the stick deflection at any yaw', () => {
    const v = screenStick(0.6, -0.8, 0.7);
    expect(Math.hypot(v.stickX, v.stickY)).toBeCloseTo(1);
  });
});

describe('vertical response', () => {
  it('falls at zero throttle, hovers at the hover throttle, climbs at full', () => {
    expect(settledSpeed(0)).toBe(-CATCH.fallSpeed);
    expect(settledSpeed(CATCH.hoverThrottle)).toBeCloseTo(0);
    expect(settledSpeed(1)).toBeCloseTo(CATCH.climbSpeed);
  });
});

describe('catch box', () => {
  it('holds the axis and keeps the hull between the open arms', () => {
    expect(inCatchBox(GEO, 0, 0)).toBe(true);
    expect(inCatchBox(GEO, 0, catchBoxHalfWidth(GEO) - 0.1)).toBe(true);
    expect(inCatchBox(GEO, 0, catchBoxHalfWidth(GEO) + 0.1)).toBe(false);
    expect(inCatchBox(GEO, -CATCH.boxBack - 0.1, 0)).toBe(false);
    expect(inCatchBox(GEO, CATCH.boxFront + 0.1, 0)).toBe(false);
  });
});

describe('descent outcomes', () => {
  it('a careful pilot gets a soft centred catch with 3 stars and fuel to spare, in 60 to 120 s', () => {
    const f = fly(careful());
    expect(f.end).toMatchObject({ type: 'caught', hard: false, stars: 3 });
    expect(f.sim.state.fuel).toBeGreaterThan(0.35);
    expect(f.sim.state.fuel).toBeLessThan(0.65);
    expect(f.sim.state.time).toBeGreaterThanOrEqual(60);
    expect(f.sim.state.time).toBeLessThanOrEqual(120);
    expect(f.events.some((e) => e.type === 'lowFuel' || e.type === 'fuelEmpty')).toBe(false);
  });

  it('works from every start direction', () => {
    for (let seed = 1; seed <= 20; seed++) expect(fly(careful(), seed).end).toMatchObject({ type: 'caught', stars: 3 });
  });

  it('a soft catch off-centre gets 2 stars', () => {
    const f = fly(careful(6, 0));
    expect(f.end).toMatchObject({ type: 'caught', hard: false, stars: 2 });
  });

  it('a hard catch near the centre gets 2 stars, off-centre 1', () => {
    expect(fly(careful(0, 0, 4.5)).end).toMatchObject({ type: 'caught', hard: true, stars: 2 });
    expect(fly(careful(6, 0, 4.5)).end).toMatchObject({ type: 'caught', hard: true, stars: 1 });
  });

  it('arriving faster than hardSpeed crashes at the arms', () => {
    const f = fly(careful(0, 0, 9));
    expect(f.end).toMatchObject({ type: 'crash', kind: 'tooFast' });
    if (f.end?.type === 'crash') expect(f.end.at.y).toBe(GEO.catchY);
  });

  it('arriving outside the box onto an arm explodes at the arm', () => {
    expect(fly(careful(0, 12)).end).toMatchObject({ type: 'crash', kind: 'arms' });
  });

  it('arriving outside the box clear of everything explodes on the ground', () => {
    const f = fly(careful(0, -30));
    expect(f.end).toMatchObject({ type: 'crash', kind: 'ground' });
    if (f.end?.type === 'crash') expect(f.end.at.y).toBe(0);
  });

  it('descending onto the tower explodes at the tower', () => {
    expect(fly(careful(-21, 0)).end).toMatchObject({ type: 'crash', kind: 'tower' });
  });

  it('arriving with too much sideways speed is tilted and crashes', () => {
    const f = fly((s) => {
      const h = heightAbove(s);
      const throttle = throttleFor(s, schedule(2)(h));
      return h > 8 ? { throttle, ...steerTo(s, 20, 0) } : { throttle, stickX: -1 };
    });
    expect(f.end).toMatchObject({ type: 'crash', kind: 'tilted' });
    expect(f.sim.state.tilt).toBeGreaterThanOrEqual(CATCH.maxTilt);
  });

  it('hovering runs the tank dry, warns twice, then falls to a crash', () => {
    const f = fly(() => ({ throttle: CATCH.hoverThrottle }));
    const types = f.events.map((e) => e.type);
    expect(types.filter((t) => t === 'lowFuel')).toHaveLength(1);
    expect(types.filter((t) => t === 'fuelEmpty')).toHaveLength(1);
    expect(types.indexOf('lowFuel')).toBeLessThan(types.indexOf('fuelEmpty'));
    expect(f.end).toMatchObject({ type: 'crash', kind: 'ground' });
    expect(f.sim.state.fuel).toBe(0);
  });

  it('running dry over the box crashes there', () => {
    const g = fly((s) => (Math.hypot(s.x, s.z) > 1 || heightAbove(s) > 100 ? careful()(s) : { throttle: 1 }), 1, 1000);
    expect(g.events.some((e) => e.type === 'fuelEmpty')).toBe(true);
    expect(g.end).toMatchObject({ type: 'crash', kind: 'noFuel' });
  });

  it('doing nothing is a free fall to a crash on the ground with slower warnings', () => {
    const f = fly(() => ({}));
    expect(f.end).toMatchObject({ type: 'crash', kind: 'ground' });
    expect(f.events.some((e) => e.type === 'slower')).toBe(true);
    expect(f.sim.state.time).toBeLessThan(40);
  });

  it('slower warnings come at most every slowerEvery seconds', () => {
    const sim = createCatchSim(GEO, seeded(1));
    const times: number[] = [];
    while (sim.state.phase === 'flying') {
      for (const e of sim.step(DT, { throttle: 0, stickX: 0, stickY: 0, armed: true })) if (e.type === 'slower') times.push(sim.state.time);
    }
    for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(CATCH.slowerEvery - 1e-9);
  });
});

describe('descend prompt', () => {
  it('fires when the booster stops sinking high up, repeats at most every descendEvery seconds, and clears on descent', () => {
    const sim = createCatchSim(GEO, seeded(1));
    const times: number[] = [];
    while (sim.state.time < 20) {
      for (const e of sim.step(DT, { throttle: 1, stickX: 0, stickY: 0, armed: true })) if (e.type === 'descend') times.push(sim.state.time);
    }
    expect(sim.state.stalled).toBe(true);
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times[0]).toBeGreaterThan(CATCH.stallSeconds);
    expect(times[0]).toBeLessThan(CATCH.stallSeconds + 2);
    for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(CATCH.descendEvery - 1e-9);
    while (sim.state.time < 25) sim.step(DT, { throttle: 0.3, stickX: 0, stickY: 0, armed: true });
    expect(sim.state.stalled).toBe(false);
  });

  it('never fires on a careful descent', () => {
    expect(fly(careful()).events.some((e) => e.type === 'descend')).toBe(false);
  });

  it('never fires below approachHeight', () => {
    const f = fly((s) => (heightAbove(s) > CATCH.approachHeight - 20 ? careful()(s) : { throttle: CATCH.hoverThrottle, ...steerTo(s, 0, 0) }), 1, 60);
    expect(f.events.some((e) => e.type === 'descend')).toBe(false);
    expect(f.sim.state.stalled).toBe(false);
  });
});

describe('assist', () => {
  /** Steers to (6, 5) and descends carefully; below 200 m lets go of the stick, or holds it at `hold`. */
  const approach =
    (hold: Partial<InputState>): Pilot =>
    (s) => {
      const p = careful(6, 5)(s);
      return heightAbove(s) > 200 ? p : { throttle: p.throttle, ...hold };
    };

  it('pulls a slightly-off approach towards the axis', () => {
    const f = fly(approach({}));
    expect(f.end).toMatchObject({ type: 'caught', stars: 3 });
    if (f.end?.type === 'caught') expect(f.end.offset).toBeLessThan(CATCH.centreRadius);
  });

  it('does not rescue a stick held the wrong way', () => {
    const f = fly(approach({ stickX: 0.5 }));
    expect(f.end?.type).toBe('crash');
    expect(Math.hypot(f.sim.state.x, f.sim.state.z)).toBeGreaterThan(CATCH.assistRadiusFactor * 2 * catchBoxHalfWidth(GEO));
  });

  it('never changes the vertical speed', () => {
    const a = createCatchSim(GEO, seeded(1));
    const b = createCatchSim(GEO, seeded(1));
    b.state.x = 5;
    b.state.z = 0;
    for (let i = 0; i < 300; i++) {
      a.step(DT, { throttle: 0.4, stickX: 0, stickY: 0, armed: true });
      b.step(DT, { throttle: 0.4, stickX: 0, stickY: 0, armed: true });
    }
    expect(b.state.vy).toBe(a.state.vy);
    expect(b.state.x).toBeLessThan(5);
  });
});

describe('speed light', () => {
  it('is green high up and slow, yellow then red as the braking height runs out', () => {
    expect(speedLight(500, 10)).toBe('green');
    expect(speedLight(500, 40)).toBe('green');
    expect(speedLight(150, 40)).toBe('yellow');
    expect(speedLight(60, 40)).toBe('red');
    expect(speedLight(200, 2)).toBe('green');
    expect(speedLight(31, 25)).toBe('red');
  });

  it('shows the catch thresholds in the last metres', () => {
    expect(speedLight(20, 2)).toBe('green');
    expect(speedLight(20, 4)).toBe('yellow');
    expect(speedLight(20, 7)).toBe('red');
  });
});
