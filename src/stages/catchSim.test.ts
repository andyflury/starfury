import { describe, expect, it } from 'vitest';
import { CATCH, SHIP_CATCH } from '../tuning.ts';
import type { InputState } from '../types.ts';
import { SHIP_TUNING, catchBoxHalfWidth, createCatchSim, flipLight, hullAxis, inCatchBox, screenStick, settledSpeed, speedLight } from './catchSim.ts';
import type { CatchEvent, CatchGeometry, CatchSim, CatchState, CatchTuning } from './catchSim.ts';

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

/** The ship's measurements with the same tower and mount, the arm carriage near the top of the tower. */
const SHIP_GEO: CatchGeometry = { ...GEO, catchY: 128, pinHeight: 32.5, height: 50 };

/** A vehicle to catch: its tunables and its measurements. */
interface Config {
  c: CatchTuning;
  geo: CatchGeometry;
}
const BOOSTER: Config = { c: CATCH, geo: GEO };
const SHIP: Config = { c: SHIP_TUNING, geo: SHIP_GEO };
const BELLY = SHIP_CATCH.belly;

/** A pilot's wish in the world frame: stickX towards +X, stickY towards -Z. */
type Pilot = (s: CatchState) => Partial<InputState>;

interface Flight {
  sim: CatchSim;
  events: CatchEvent[];
  end: CatchEvent | undefined;
}

/** A camera yaw like the stage's: 0 high up, then swinging between the front and the side. */
const droneYaw = (s: CatchState, geo: CatchGeometry): number =>
  s.y + geo.pinHeight - geo.catchY > CATCH.approachHeight ? 0 : (Math.PI / 4) * (1 - Math.cos(s.time * 0.22));

/** Flies `pilot`, handing the sim its wish as the screen-relative stick a player would give under `droneYaw`. */
function fly(pilot: Pilot, seed = 1, maxSeconds = 400, { c, geo }: Config = BOOSTER): Flight {
  const sim = createCatchSim(c, geo, seeded(seed));
  const events: CatchEvent[] = [];
  while (sim.state.phase === 'flying' && sim.state.time < maxSeconds) {
    const wish = { throttle: 0, stickX: 0, stickY: 0, armed: true, ...pilot(sim.state) };
    const yaw = droneYaw(sim.state, geo);
    const screen = screenStick(wish.stickX, wish.stickY, -yaw);
    events.push(...sim.step(DT, { ...wish, ...screenStick(screen.stickX, screen.stickY, yaw) }));
  }
  return { sim, events, end: events.find((e) => e.type === 'caught' || e.type === 'crash') };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const heightAbove = (s: CatchState, geo = GEO): number => s.y + geo.pinHeight - geo.catchY;

/** Holds the descent speed `want(h)` with the throttle, for pins h metres above the catch point. */
function throttleFor(s: CatchState, want: number): number {
  const base = CATCH.hoverThrottle * (1 - Math.sqrt(want / CATCH.fallSpeed));
  return clamp(base + 0.05 * (-s.vy - want), 0, 1);
}

/** Steers towards (tx, tz) at up to `max` m/s. */
function steerTo(s: CatchState, tx: number, tz: number, max = 5): Partial<InputState> {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const d = Math.hypot(dx, dz);
  const speed = Math.min(max, d * 0.3);
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

/** The ship pilot: steers in at up to 8 m/s during the belly-flop, flips with full throttle at pins `flipAt` metres up, then descends carefully. */
const shipPilot =
  (flipAt: number, tx = 0, tz = 0): Pilot =>
  (s) => {
    const h = heightAbove(s, SHIP_GEO);
    if (s.flip === 0) return { throttle: h > flipAt ? 0 : 1, ...steerTo(s, tx, tz, 8) };
    return { throttle: throttleFor(s, schedule(2)(h)), ...steerTo(s, tx, tz) };
  };

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
    expect(settledSpeed(CATCH, 0)).toBe(-CATCH.fallSpeed);
    expect(settledSpeed(CATCH, CATCH.hoverThrottle)).toBeCloseTo(0);
    expect(settledSpeed(CATCH, 1)).toBeCloseTo(CATCH.climbSpeed);
  });
});

describe('catch box', () => {
  it('holds the axis and keeps the hull between the open arms', () => {
    expect(inCatchBox(CATCH, GEO, 0, 0)).toBe(true);
    expect(inCatchBox(CATCH, GEO, 0, catchBoxHalfWidth(CATCH, GEO) - 0.1)).toBe(true);
    expect(inCatchBox(CATCH, GEO, 0, catchBoxHalfWidth(CATCH, GEO) + 0.1)).toBe(false);
    expect(inCatchBox(CATCH, GEO, -CATCH.boxBack - 0.1, 0)).toBe(false);
    expect(inCatchBox(CATCH, GEO, CATCH.boxFront + 0.1, 0)).toBe(false);
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
    const sim = createCatchSim(CATCH, GEO, seeded(1));
    const times: number[] = [];
    while (sim.state.phase === 'flying') {
      for (const e of sim.step(DT, { throttle: 0, stickX: 0, stickY: 0, armed: true })) if (e.type === 'slower') times.push(sim.state.time);
    }
    for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(CATCH.slowerEvery - 1e-9);
  });
});

describe('descend prompt', () => {
  it('fires when the booster stops sinking high up, repeats at most every descendEvery seconds, and clears on descent', () => {
    const sim = createCatchSim(CATCH, GEO, seeded(1));
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
    expect(Math.hypot(f.sim.state.x, f.sim.state.z)).toBeGreaterThan(CATCH.assistRadiusFactor * 2 * catchBoxHalfWidth(CATCH, GEO));
  });

  it('never changes the vertical speed', () => {
    const a = createCatchSim(CATCH, GEO, seeded(1));
    const b = createCatchSim(CATCH, GEO, seeded(1));
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
    expect(speedLight(CATCH, 500, 10)).toBe('green');
    expect(speedLight(CATCH, 500, 40)).toBe('green');
    expect(speedLight(CATCH, 150, 40)).toBe('yellow');
    expect(speedLight(CATCH, 60, 40)).toBe('red');
    expect(speedLight(CATCH, 200, 2)).toBe('green');
    expect(speedLight(CATCH, 31, 25)).toBe('red');
  });

  it('shows the catch thresholds in the last metres', () => {
    expect(speedLight(CATCH, 20, 2)).toBe('green');
    expect(speedLight(CATCH, 20, 4)).toBe('yellow');
    expect(speedLight(CATCH, 20, 7)).toBe('red');
  });
});

describe('booster configuration', () => {
  it('flies exactly as before the ship catch existed', () => {
    const cases: [Pilot, number, Partial<CatchEvent>, number, number][] = [
      [careful(), 1, { type: 'caught', stars: 3 }, 87.85, 0.506729],
      [careful(), 7, { type: 'caught', stars: 3 }, 87.85, 0.506729],
      [careful(6, 0), 1, { type: 'caught', stars: 2 }, 87.85, 0.506729],
      [careful(0, 0, 4.5), 2, { type: 'caught', hard: true, stars: 2 }, 80.0167, 0.575891],
      [careful(0, 12), 1, { type: 'crash', kind: 'arms', at: { x: -1.3321149629852655, y: 86, z: 12.900944909100357 } }, 64.6, 0.679897],
      [careful(-21, 0), 1, { type: 'crash', kind: 'tower', at: { x: -12.460438976525204, y: 156, z: 0.8391371888119561 } }, 52.4833, 0.759111],
      [careful(0, -30), 1, { type: 'crash', kind: 'ground' }, 100.85, 0.405798],
      [() => ({}), 3, { type: 'crash', kind: 'ground', at: { x: 192.80435799122495, y: 0, z: 53.164645579478595 } }, 20.6333, 1],
    ];
    for (const [pilot, seed, end, time, fuel] of cases) {
      const f = fly(pilot, seed);
      expect(f.end).toMatchObject(end);
      expect(f.sim.state.time).toBeCloseTo(time, 3);
      expect(f.sim.state.fuel).toBeCloseTo(fuel, 5);
    }
  });
});

describe('ship belly-flop', () => {
  it('starts horizontal, engines off, falling steadily and slower than the booster free fall', () => {
    const sim = createCatchSim(SHIP_TUNING, SHIP_GEO, seeded(1));
    expect(sim.state.flip).toBe(0);
    const axis = hullAxis(0);
    expect(axis.x).toBeCloseTo(-1, 9);
    expect(axis.y).toBeCloseTo(0, 9);
    expect(axis.z).toBeCloseTo(0, 9);
    expect(SHIP_TUNING.startDescent).toBeLessThan(CATCH.fallSpeed * 0.75);
    for (let i = 0; i < 300; i++) sim.step(DT, { throttle: BELLY.flipThrottle - 0.01, stickX: 0, stickY: 0, armed: true });
    expect(sim.state.flip).toBe(0);
    expect(sim.state.thrust).toBe(0);
    expect(sim.state.fuel).toBe(1);
    expect(sim.state.vy).toBeCloseTo(-SHIP_TUNING.startDescent, 6);
    expect(sim.state.light).toBe('green');
  });

  it('steers over the ground with the stick', () => {
    const a = createCatchSim(SHIP_TUNING, SHIP_GEO, seeded(1));
    const b = createCatchSim(SHIP_TUNING, SHIP_GEO, seeded(1));
    for (let i = 0; i < 180; i++) {
      a.step(DT, { throttle: 0, stickX: 1, stickY: 0, armed: true });
      b.step(DT, { throttle: 0, stickX: 0, stickY: 1, armed: true });
    }
    expect(a.state.vx).toBeGreaterThan(5);
    expect(b.state.vz).toBeLessThan(-5);
    expect(a.state.vy).toBeCloseTo(b.state.vy, 9);
  });

  it('flips upright over flipSeconds once the throttle passes flipThrottle, burning fuel from the start of the flip', () => {
    const sim = createCatchSim(SHIP_TUNING, SHIP_GEO, seeded(1));
    sim.step(DT, { throttle: BELLY.flipThrottle + 0.05, stickX: 0, stickY: 0, armed: true });
    expect(sim.state.flip).toBeGreaterThan(0);
    expect(sim.state.thrust).toBeGreaterThan(0);
    expect(sim.state.fuel).toBeLessThan(1);
    let steps = 1;
    while (sim.state.flip < 1) {
      sim.step(DT, { throttle: 0.1, stickX: 0, stickY: 0, armed: true });
      steps++;
    }
    expect(steps * DT).toBeCloseTo(BELLY.flipSeconds, 1);
    expect(hullAxis(sim.state.flip)).toEqual({ x: 0, y: 1, z: 0 });
    expect(sim.state.thrust).toBeCloseTo(0.1);
  });

  it('never flipping prompts at the top of the flip range and again lower, shows red below it, and ends on the ground', () => {
    const sim = createCatchSim(SHIP_TUNING, SHIP_GEO, seeded(1));
    const calls: number[] = [];
    const lights: [number, string][] = [];
    const events: CatchEvent[] = [];
    while (sim.state.phase === 'flying') {
      const es = sim.step(DT, { throttle: 0, stickX: 0, stickY: 0, armed: true });
      events.push(...es);
      if (es.some((e) => e.type === 'flipNow')) calls.push(heightAbove(sim.state, SHIP_GEO));
      lights.push([heightAbove(sim.state, SHIP_GEO), sim.state.light]);
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBeCloseTo(BELLY.flipTop, -0.3);
    expect(calls[1]).toBeCloseTo(BELLY.flipTop - BELLY.flipRepeatDrop, -0.3);
    for (const [h, light] of lights) if (h > 0) expect(light).toBe(flipLight(BELLY, h));
    expect(flipLight(BELLY, BELLY.flipTop + 1)).toBe('green');
    expect(flipLight(BELLY, BELLY.flipBottom + 1)).toBe('yellow');
    expect(flipLight(BELLY, BELLY.flipBottom - 1)).toBe('red');
    expect(events.some((e) => e.type === 'slower')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'crash', kind: 'ground' });
  });
});

describe('ship catch outcomes', () => {
  it('a careful pilot flipping anywhere in the comfortable range gets 3 stars with fuel to spare, without a low-fuel warning', () => {
    for (const flipAt of [BELLY.flipTop, (BELLY.flipTop + BELLY.flipBottom) / 2, BELLY.flipBottom]) {
      for (let seed = 1; seed <= 10; seed++) {
        const f = fly(shipPilot(flipAt), seed, 400, SHIP);
        expect(f.end).toMatchObject({ type: 'caught', hard: false, stars: 3 });
        expect(f.sim.state.fuel).toBeGreaterThan(SHIP_TUNING.lowFuel);
        expect(f.events.some((e) => e.type === 'lowFuel')).toBe(false);
        expect(f.sim.state.time).toBeGreaterThan(30);
        expect(f.sim.state.time).toBeLessThan(90);
      }
    }
  });

  it('flipping at the very top runs the tank dry and crashes', () => {
    const f = fly(shipPilot(Infinity), 1, 400, SHIP);
    expect(f.events.some((e) => e.type === 'lowFuel')).toBe(true);
    expect(f.events.some((e) => e.type === 'fuelEmpty')).toBe(true);
    expect(f.end).toMatchObject({ type: 'crash' });
  });

  it('flipping too late crashes into the tower or the arms', () => {
    for (const flipAt of [40, 30, 20]) {
      const f = fly(shipPilot(flipAt), 1, 400, SHIP);
      expect(f.end?.type === 'crash' && ['tower', 'arms'].includes(f.end.kind)).toBe(true);
      expect(f.sim.state.flip).toBeLessThan(1);
    }
  });

  it('a soft catch off-centre gets 2 stars', () => {
    expect(fly(shipPilot(200, 6, 0), 1, 400, SHIP).end).toMatchObject({ type: 'caught', hard: false, stars: 2 });
  });

  it('descending onto the tower in the belly-flop explodes at the tower', () => {
    const sim = createCatchSim(SHIP_TUNING, SHIP_GEO, seeded(1));
    sim.state.x = -25;
    sim.state.z = 0;
    const events: CatchEvent[] = [];
    while (sim.state.phase === 'flying') events.push(...sim.step(DT, { throttle: 0, stickX: 0, stickY: 0, armed: true }));
    const end = events.at(-1);
    expect(end).toMatchObject({ type: 'crash', kind: 'tower' });
    if (end?.type === 'crash') expect(end.at.y).toBe(GEO.footprint.top);
    expect(sim.state.y + SHIP_GEO.height / 2 - SHIP_GEO.radius).toBeLessThan(GEO.footprint.top);
    expect(sim.state.y + SHIP_GEO.height / 2 - SHIP_GEO.radius).toBeGreaterThan(GEO.footprint.top - 1);
  });
});
