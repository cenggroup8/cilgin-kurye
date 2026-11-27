import { describe, expect, it } from 'vitest';
import {
  addBike,
  BIKE_STAGES,
  COLLIDE_STAGES,
  createWorld,
  DEFAULT_BIKE_TUNING,
  EMPTY_STAGES,
  Predictor,
  stepPhysics,
  type BikeControl,
  type BikeState,
  type PhysicsInput,
  type PhysicsWorld,
} from '../../src/physics/index.js';
import { nextSpeed, nextStoppedS } from '../../src/physics/bike/model.js';
import { BIKE_RADIUS_M } from '../../src/physics/collide/constants.js';
import { FakeM1 } from '../fakes/fakeM1.js';

const DT = 1 / 30;
const H = DT / 2; // one substep
const T = DEFAULT_BIKE_TUNING;
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };
const FALL = 6;
/** A motorcycle that has already stood still for the whole wait (so the reverse may start). */
const WAITED = T.reverseWaitS;

interface Ctl {
  throttle?: number;
  brake?: number;
  steer?: number;
}

function tick(world: PhysicsWorld, t: number, c: Ctl, stages = STAGES) {
  const input: PhysicsInput = {
    tick: t,
    dt: DT,
    bikes: [{ player: 0, speedFactor: 1, control: { throttle: c.throttle ?? 0, brake: c.brake ?? 0, steer: c.steer ?? 0, seq: t } }],
    obstacles: [],
    npcCars: [],
    quake: null,
    fall: [],
    standUp: [],
  };
  return stepPhysics(world, input, stages);
}

function ride(world: PhysicsWorld, ticks: number, ctl: (b: BikeState, t: number) => Ctl, each?: (b: BikeState) => void, stages = STAGES): BikeState {
  const bike = world.bikes.get(0)!;
  for (let t = 0; t < ticks; t++) {
    tick(world, t, ctl(bike, t), stages);
    each?.(bike);
  }
  return bike;
}

function standing(speed = 0, heading = 0, at = { x: 0, y: 0 }): PhysicsWorld {
  const world = createWorld();
  addBike(world, 0, { ...at, heading }).speed = speed;
  return world;
}

describe('nextSpeed: the rule', () => {
  it('a standing motorcycle with the brake goes backwards by reverseAccel x brake x h in one substep', () => {
    expect(nextSpeed(0, 0, 1, 15, null, H, T, WAITED)).toBeCloseTo(-T.reverseAccel * H, 12);
    expect(nextSpeed(0, 0, 0.5, 15, null, H, T, WAITED)).toBeCloseTo(-0.5 * T.reverseAccel * H, 12);
  });

  it('never goes below -reverseMax', () => {
    let v = 0;
    for (let i = 0; i < 1000; i++) {
      v = nextSpeed(v, 0, 1, 15, null, H, T, WAITED);
      expect(v).toBeGreaterThanOrEqual(-T.reverseMax);
    }
    expect(v).toBe(-T.reverseMax);
  });

  it('forward braking only stops: it never goes below 0 (the motorcycle has not stood for the wait yet)', () => {
    let v = 15;
    for (let i = 0; i < 200 && v > 0; i++) {
      const next = nextSpeed(v, 0, 1, 15, null, H, T, 0);
      expect(next).toBeGreaterThanOrEqual(0);
      v = next;
    }
    expect(v).toBe(0);
  });

  it('reverse does not start above reverseEnterSpeed', () => {
    expect(nextSpeed(T.reverseEnterSpeed + 0.01, 0, 1, 15, null, H, T, WAITED)).toBeGreaterThanOrEqual(0);
    expect(nextSpeed(T.reverseEnterSpeed, 0, 1, 15, null, H, T, WAITED)).toBeLessThan(T.reverseEnterSpeed);
  });

  it('with throttle the brake does not reverse', () => {
    expect(nextSpeed(0, 0.2, 1, 15, null, H, T, WAITED)).toBeGreaterThanOrEqual(0);
  });

  it('a reversing motorcycle goes back to 0 with the brake deceleration and not past it, when the brake is let go or throttle is given', () => {
    expect(nextSpeed(-2, 0, 0, 15, null, H, T, 0)).toBeCloseTo(-2 + T.brake * H, 12);
    expect(nextSpeed(-2, 1, 0, 15, null, H, T, 0)).toBeCloseTo(-2 + T.brake * H, 12);
    expect(nextSpeed(-0.1, 0, 0, 15, null, H, T, 0)).toBe(0);
    expect(nextSpeed(-0.1, 1, 0, 15, null, H, T, 0)).toBe(0);
  });

  it('the speed cap of an accident zone only touches forward speed', () => {
    expect(nextSpeed(-2, 0, 1, 15, 5, H, T, 0)).toBeLessThan(-2);
    expect(nextSpeed(10, 0, 0, 15, 5, H, T, 0)).toBeLessThan(10);
  });
});

describe('reverse in the world', () => {
  it('a standing motorcycle with the brake: after the wait the speed gets negative, the first tick is at most reverseAccel x dt, never below -reverseMax', () => {
    const world = standing();
    let min = 0;
    let first = 0;
    ride(world, 30 * 5, () => ({ brake: 1 }), (b) => {
      if (first === 0 && b.speed < 0) first = b.speed;
      min = Math.min(min, b.speed);
    });
    expect(first).toBeLessThan(0);
    expect(Math.abs(first)).toBeLessThanOrEqual(T.reverseAccel * DT + 1e-12); // a whole tick = two substeps
    expect(min).toBe(-T.reverseMax);
    expect(world.bikes.get(0)!.x).toBeLessThan(-5);
  });

  it('braking from speed stops first and does not jump to a big negative speed', () => {
    const world = standing(15);
    const speeds: number[] = [];
    ride(world, 30 * 3, () => ({ brake: 1 }), (b) => speeds.push(b.speed));
    const stop = speeds.findIndex((v) => v <= 0.05);
    expect(stop).toBeGreaterThan(0);
    // Until it stands, nothing below -reverseAccel x tick; after it stands the speed goes down slowly.
    for (let i = 0; i < speeds.length; i++) {
      const prev = i === 0 ? 15 : speeds[i - 1];
      expect(speeds[i]).toBeGreaterThanOrEqual(Math.min(prev, 0.05) - T.reverseAccel * DT - 1e-9);
    }
  });

  it('throttle while reversing: the speed goes to 0 and then forward', () => {
    const world = standing();
    const bike = world.bikes.get(0)!;
    ride(world, 60, () => ({ brake: 1 }));
    expect(bike.speed).toBe(-T.reverseMax);
    let zeroAt = -1;
    const speeds: number[] = [];
    ride(world, 90, () => ({ throttle: 1 }), (b) => {
      speeds.push(b.speed);
      if (zeroAt < 0 && b.speed >= 0) zeroAt = speeds.length;
    });
    expect(zeroAt).toBeGreaterThan(0);
    expect(speeds[speeds.length - 1]).toBeGreaterThan(3);
    // Going up only, and no forward speed before it passed 0.
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1] - 1e-12);
  });

  it('letting go of the brake brings the reverse speed back to 0 and it stays there', () => {
    const world = standing();
    const bike = world.bikes.get(0)!;
    ride(world, 60, () => ({ brake: 1 }));
    expect(bike.speed).toBeLessThan(-2);
    ride(world, 30, () => ({}));
    expect(bike.speed).toBe(0);
  });

  it('reversing and steering right turns the other way than driving forward (and the same input gives the same result)', () => {
    const turnOf = (reverse: boolean): number => {
      const world = standing(reverse ? 0 : 3);
      const bike = world.bikes.get(0)!;
      if (reverse) bike.speed = -2;
      for (let t = 0; t < 10; t++) {
        // Hold the speed by hand, so only the direction of the steering is tested.
        bike.speed = reverse ? -2 : 3;
        tick(world, t, { steer: 1, throttle: reverse ? 0 : 0.2 });
      }
      return bike.heading;
    };
    const forward = turnOf(false);
    const back = turnOf(true);
    expect(forward).toBeLessThan(0); // right turn: clockwise, heading gets smaller
    expect(back).toBeGreaterThan(0); // the other way
    expect(turnOf(true)).toBe(back);
  });

  it('reversing in a turn with too little grip slides to the outside of the real path', () => {
    const world = standing();
    world.params.grip = 0.2;
    const bike = world.bikes.get(0)!;
    for (let t = 0; t < 15; t++) {
      bike.speed = -2.5;
      tick(world, t, { steer: 1 });
    }
    // Reversing with the wheel to the right: heading turns counter clockwise (left), the centre of the path is on the right, so the slide goes to the left (positive).
    expect(bike.heading).toBeGreaterThan(0);
    expect(bike.slip).toBeGreaterThan(0);
  });
});

describe('reverse and walls', () => {
  // A building to the west of x = 10: reversing east hits its west... see below.
  const BUILDING = [{ x: 10, y: -5 }, { x: 20, y: -5 }, { x: 20, y: 5 }, { x: 10, y: 5 }];
  const STAGES_ALL = { ...EMPTY_STAGES, ...BIKE_STAGES, ...COLLIDE_STAGES };

  it('backing into a building is a bump, not a fall, and the speed is 0', () => {
    const world = createWorld();
    world.buildings = [BUILDING];
    // The rider faces west (heading pi) with the building behind, to the east. Reverse goes east.
    const bike = addBike(world, 0, { x: 9, y: 0, heading: Math.PI });
    const events: unknown[] = [];
    let maxImpact = 0;
    for (let t = 0; t < 30 * 8; t++) {
      const out = tick(world, t, { brake: 1 }, STAGES_ALL);
      for (const e of out.events) {
        events.push(e);
        maxImpact = Math.max(maxImpact, e.impactSpeed);
      }
    }
    expect(events.some((e) => (e as { kind: string; with?: string }).kind === 'collision' && (e as { with: string }).with === 'building')).toBe(true);
    expect(events.some((e) => (e as { kind: string }).kind === 'fall')).toBe(false);
    expect(maxImpact).toBeGreaterThan(0);
    expect(maxImpact).toBeLessThanOrEqual(T.reverseMax + 1e-9);
    expect(T.reverseMax).toBeLessThan(FALL);
    expect(bike.fallen).toBe(false);
    expect(bike.x).toBeLessThanOrEqual(10 - BIKE_RADIUS_M);
  });
});

describe('reverse in the real city (FakeM1)', () => {
  // Player 0 starts at the blue store (18, -18) heading east. The first building has a west face at x = 30 (y from -30 to -10).
  // The rider drives slowly into it and rests, holds the brake to back away, then lets go and drives to the road in the north
  // (first to (24, -6), then east along the road at y = -3.5).
  const WAY_A = { x: 24, y: -6 };
  const WAY_B = { x: 160, y: -3.5 };

  function run() {
    let phase = 'approach';
    let phaseStart = 0;
    let awayStart = -1;
    let backedFrom = 0;
    let backedTo = 0;
    let aimAtB = false;
    const fake = new FakeM1({
      seed: 3,
      players: [0],
      control: (t, _p, b) => {
        if (phase === 'approach') {
          if (b.x > 30 - BIKE_RADIUS_M - 0.2) {
            phase = 'rest';
            phaseStart = t;
          }
          return { throttle: b.speed < 2 ? 0.3 : 0 };
        }
        if (phase === 'rest') {
          if (t - phaseStart >= 15) {
            phase = 'back';
            phaseStart = t;
            backedFrom = b.x;
          }
          return {};
        }
        if (phase === 'back') {
          backedTo = b.x;
          if (t - phaseStart >= 30 * 4) {
            phase = 'away';
            awayStart = t;
          }
          return { brake: 1 };
        }
        // Away: steer towards the waypoints (positive steer is right, so a target on the left gives a negative steer).
        if (!aimAtB && Math.hypot(WAY_A.x - b.x, WAY_A.y - b.y) < 4) aimAtB = true;
        const target = aimAtB ? WAY_B : WAY_A;
        let err = Math.atan2(target.y - b.y, target.x - b.x) - b.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err <= -Math.PI) err += 2 * Math.PI;
        return { throttle: Math.abs(err) > 0.5 ? 0.3 : 0.6, steer: Math.max(-1, Math.min(1, -2 * err)) };
      },
    });
    const ticks = [];
    for (let i = 0; i < 2000; i++) {
      ticks.push(fake.step());
      if (awayStart >= 0 && fake.tick - awayStart >= 30 * 10) break; // 10 s after the brake is let go
    }
    return { ticks, backedFrom, backedTo, awayStart };
  }

  const distToBuilding = (x: number, y: number): number => {
    // Distance to the west face x = 30 for y in [-30, -10] (the part of the first building near the start).
    const cy = Math.max(-30, Math.min(-10, y));
    return Math.hypot(Math.max(0, 30 - x), y - cy);
  };

  it('the motorcycle rests against the building, backs away at least 3 m, is never inside', () => {
    const { ticks, backedFrom, backedTo } = run();
    expect(backedFrom).toBeGreaterThan(30 - BIKE_RADIUS_M - 0.5);
    expect(backedFrom - backedTo).toBeGreaterThanOrEqual(3);
    for (const t of ticks) for (const b of t.physics.bikes) expect(b.x <= 30 - BIKE_RADIUS_M + 1e-3 || b.y > -10 + BIKE_RADIUS_M - 1e-3).toBe(true);
    expect(ticks.flatMap((t) => t.physics.events).some((e) => e.kind === 'fall')).toBe(false);
  });

  it('steering and throttle then take it away from the building: after 10 s it is more than 3 m away', () => {
    const { ticks } = run();
    const last = ticks[ticks.length - 1].physics.bikes[0];
    expect(last.fallen).toBe(false);
    expect(distToBuilding(last.x, last.y)).toBeGreaterThan(3);
  });

  it('the same input gives the same result', () => {
    expect(JSON.stringify(run().ticks)).toBe(JSON.stringify(run().ticks));
  });
});

describe('predictor and server agree with reverse', () => {
  it('the same controls with reverse give the same pose on the server world and the predictor', () => {
    const START = { x: 0, y: 0, heading: 0.4 };
    const control = (t: number): BikeControl => ({
      throttle: t % 120 >= 70 && t % 120 < 100 ? 1 : 0,
      brake: t % 120 < 60 ? 1 : 0, // standing: reverse, then...
      steer: Math.round(Math.sin(t / 20) * 2) / 2,
      seq: t,
    });
    const server = createWorld();
    addBike(server, 0, START);
    const predictor = new Predictor(0, START);
    let minSpeed = 0;
    for (let t = 0; t < 400; t++) {
      const c = control(t);
      stepPhysics(server, { tick: t, dt: DT, bikes: [{ player: 0, speedFactor: 1, control: c }], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [] }, STAGES);
      predictor.step(c);
      const s = server.bikes.get(0)!;
      minSpeed = Math.min(minSpeed, s.speed);
      expect(predictor.bike.x).toBe(s.x);
      expect(predictor.bike.y).toBe(s.y);
      expect(predictor.bike.heading).toBe(s.heading);
      expect(predictor.bike.speed).toBe(s.speed);
    }
    expect(minSpeed).toBeLessThan(-1); // reverse really happened
  });

  it('a server state with a negative speed is taken and replayed without a jump', () => {
    const START = { x: 0, y: 0, heading: 0 };
    const server = createWorld();
    addBike(server, 0, START);
    const predictor = new Predictor(0, START);
    const ctl = (t: number): BikeControl => ({ throttle: 0, brake: 1, steer: 0, seq: t });
    for (let t = 0; t < 60; t++) {
      stepPhysics(server, { tick: t, dt: DT, bikes: [{ player: 0, speedFactor: 1, control: ctl(t) }], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [] }, STAGES);
      predictor.step(ctl(t));
      if (t === 30) predictor.onServerState({ ...server.bikes.get(0)! }, 30);
    }
    const s = server.bikes.get(0)!;
    expect(s.speed).toBeLessThan(0);
    expect(predictor.bike.x).toBeCloseTo(s.x, 9);
    expect(predictor.drawPose().x).toBeCloseTo(s.x, 6);
  });
});

// ---- the wait before the reverse (LatifY, #80): the motorcycle must stand for reverseWaitS first ----

/** One substep of the speed rule by hand: the speed with the old counter, then the counter with the new speed. */
function substep(st: { v: number; s: number }, throttle: number, brake: number, h = H): number {
  st.v = nextSpeed(st.v, throttle, brake, 15, null, h, T, st.s);
  st.s = nextStoppedS(st.s, st.v, throttle, brake, h, T);
  return st.v;
}

describe('the reverse starts only after the wait', () => {
  it('(1)(2) a standing motorcycle with the brake: no reverse in the first 30 substeps, the reverse starts in the 31st (exact, no off-by-one)', () => {
    const st = { v: 0, s: 0 };
    const speeds: number[] = [];
    for (let i = 0; i < 35; i++) speeds.push(substep(st, 0, 1));
    expect(speeds.slice(0, 30).every((v) => v === 0)).toBe(true);
    expect(speeds[29]).toBe(0); // after 29 completed substeps and the 30th: still no reverse
    expect(speeds[30]).toBeCloseTo(-T.reverseAccel * H, 12);
    expect(Math.round(T.reverseWaitS / H)).toBe(30);
  });

  it('(2) the sum of 30 substeps is a hair below 0.5 s, and the reverse still starts on time (the slack of the compare)', () => {
    let sum = 0;
    for (let i = 0; i < 30; i++) sum += H;
    expect(sum).toBeLessThan(T.reverseWaitS); // 0.49999999999999994: without the slack the reverse would start one substep late
    const st = { v: 0, s: 0 };
    for (let i = 0; i < 30; i++) substep(st, 0, 1);
    expect(nextSpeed(st.v, 0, 1, 15, null, H, T, st.s)).toBeLessThan(0);
  });

  it('(1) in the world: no reverse in 14 ticks (28 substeps), and the first negative speed after tick 15 (index)', () => {
    const world = standing();
    const speeds: number[] = [];
    ride(world, 20, () => ({ brake: 1 }), (b) => speeds.push(b.speed));
    expect(speeds.slice(0, 15).every((v) => v === 0)).toBe(true); // 15 ticks = 30 substeps
    expect(speeds[15]).toBeLessThan(0); // the 31st substep is the first of tick 15
    expect(speeds[15]).toBeCloseTo(-2 * T.reverseAccel * H, 12);
  });

  it('(3) the throttle resets the counter: the wait starts again', () => {
    const st = { v: 0, s: 0 };
    for (let i = 0; i < 20; i++) substep(st, 0, 1);
    expect(st.s).toBeCloseTo(20 * H, 12);
    substep(st, 0.1, 0); // a little throttle in one substep
    expect(st.s).toBe(0);
    const speeds: number[] = [];
    for (let i = 0; i < 32; i++) speeds.push(substep(st, 0, 1));
    expect(speeds.slice(0, 30).every((v) => v >= 0)).toBe(true);
    expect(speeds[30]).toBeLessThan(0);
  });

  it('(3) the throttle together with the brake does not count, and releasing the brake resets it too', () => {
    const st = { v: 0, s: 0 };
    for (let i = 0; i < 20; i++) substep(st, 0, 1);
    substep(st, 0, 0); // brake let go for one substep
    expect(st.s).toBe(0);
    for (let i = 0; i < 20; i++) substep(st, 0.2, 1); // throttle and brake
    expect(st.s).toBe(0);
  });

  it('(4) after a reverse, letting go of the brake and pressing it again waits from the start', () => {
    const st = { v: 0, s: 0 };
    for (let i = 0; i < 45; i++) substep(st, 0, 1);
    expect(st.v).toBeLessThan(-0.3);
    for (let i = 0; i < 60 && st.v !== 0; i++) substep(st, 0, 0); // back to 0 without the brake
    expect(st.v).toBe(0);
    expect(st.s).toBe(0);
    const speeds: number[] = [];
    for (let i = 0; i < 32; i++) speeds.push(substep(st, 0, 1));
    expect(speeds.slice(0, 30).every((v) => v === 0)).toBe(true);
    expect(speeds[30]).toBeLessThan(0);
  });

  it('(6) braking from speed: the wait counts from the moment it stands, about 0.5 s later the reverse starts', () => {
    const world = standing(6);
    const speeds: number[] = [];
    ride(world, 60, () => ({ brake: 1 }), (b) => speeds.push(b.speed));
    const stood = speeds.findIndex((v) => v <= T.reverseEnterSpeed);
    const reverse = speeds.findIndex((v) => v < 0);
    expect(stood).toBeGreaterThanOrEqual(0);
    expect(reverse).toBeGreaterThan(stood);
    // 6 m/s with the brake of 10 m/s^2 stops in 0.6 s; the reverse comes 0.5 s (15 ticks) later.
    expect(reverse - stood).toBe(15); // measured: it stands in tick 17, the reverse is in tick 32
    // The reverse starts in the FIRST substep of tick 32, so the whole tick is reverse: -2 x reverseAccel x h.
    // (If the counter used the old speed, the reverse would begin one substep later and this would be half.)
    expect(speeds[reverse]).toBeCloseTo(-2 * T.reverseAccel * H, 9);
    expect(speeds.slice(0, reverse).every((v) => v >= 0)).toBe(true);
  });

  it('(6) braking from speed, substep by substep: the reverse starts exactly 30 substeps after the first substep in which it stands (the counter uses the new speed)', () => {
    const st = { v: 6, s: 0 };
    let stood = -1;
    let reverse = -1;
    for (let i = 0; i < 200 && reverse < 0; i++) {
      substep(st, 0, 1);
      if (stood < 0 && st.v <= T.reverseEnterSpeed) stood = i;
      if (st.v < 0) reverse = i;
    }
    expect(stood).toBe(34); // 6 m/s with 10 m/s^2: 36 substeps of 1/60 s are needed, the speed is below 0.05 in the 35th
    expect(reverse - stood).toBe(30);
  });

  it('(7) a fall resets the counter: after the stand up the wait starts again', () => {
    const world = standing();
    const bike = world.bikes.get(0)!;
    ride(world, 10, () => ({ brake: 1 }));
    expect(world.stoppedS.get(0)!).toBeCloseTo(20 * H, 9);
    // M1 drops the motorcycle (earthquake): the next substep with the fallen motorcycle resets the counter.
    stepPhysics(world, { tick: 10, dt: DT, bikes: [], obstacles: [], npcCars: [], quake: null, fall: [0], standUp: [] }, STAGES);
    expect(bike.fallen).toBe(true);
    expect(world.stoppedS.get(0)).toBe(0);
    stepPhysics(world, { tick: 11, dt: DT, bikes: [], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [0] }, STAGES);
    expect(bike.fallen).toBe(false);
    const speeds: number[] = [];
    ride(world, 20, () => ({ brake: 1 }), (b) => speeds.push(b.speed));
    expect(speeds.slice(0, 15).every((v) => v === 0)).toBe(true);
    expect(speeds[15]).toBeLessThan(0);
  });

  it('the counter is kept in the world, not in the motorcycle: it is not in the output of the step', () => {
    const world = standing();
    const out = tick(world, 0, { brake: 1 });
    expect(Object.keys(out.bikes[0])).not.toContain('stoppedS');
    expect(Object.keys(world.bikes.get(0)!)).not.toContain('stoppedS');
    expect(world.stoppedS.has(0)).toBe(true);
  });

  it('removing a motorcycle removes its counter', async () => {
    const { removeBike } = await import('../../src/physics/index.js');
    const world = standing();
    removeBike(world, 0);
    expect(world.stoppedS.has(0)).toBe(false);
  });

  it('(9) the wait is 0.5 s for other substep lengths too (SUBSTEPS_PER_TICK is a constant, so tried by hand with h)', () => {
    for (const substeps of [2, 3, 4]) {
      const h = DT / substeps;
      const st = { v: 0, s: 0 };
      let first = -1;
      for (let i = 0; i < 200 && first < 0; i++) if (substep(st, 0, 1, h) < 0) first = i;
      const seconds = first * h;
      expect(seconds, `${substeps} substeps per tick`).toBeGreaterThanOrEqual(T.reverseWaitS - 1e-9);
      expect(seconds, `${substeps} substeps per tick`).toBeLessThan(T.reverseWaitS + h);
    }
  });
});

describe('the wait after a hit', () => {
  const BUILDING = [{ x: 10, y: -5 }, { x: 20, y: -5 }, { x: 20, y: 5 }, { x: 10, y: 5 }];
  const STAGES_ALL = { ...EMPTY_STAGES, ...BIKE_STAGES, ...COLLIDE_STAGES };

  it('(5) a motorcycle that stops at a wall waits the same time before it backs away', () => {
    const world = createWorld();
    world.buildings = [BUILDING];
    const bike = addBike(world, 0, { x: 10 - BIKE_RADIUS_M - 0.2, y: 0, heading: 0 });
    bike.speed = 4;
    const speeds: number[] = [];
    ride(world, 30, () => ({ brake: 1 }), (b) => speeds.push(b.speed), STAGES_ALL);
    const stopped = speeds.findIndex((v) => Math.abs(v) < 1e-9); // the tick of the hit: the speed is 0
    const reverse = speeds.findIndex((v) => v < -1e-6);
    expect(stopped).toBeGreaterThanOrEqual(0);
    // Measured: the hit is in tick 1, the wait is counted in the ticks 2 to 16 (30 substeps) and the reverse starts in tick 17.
    expect(reverse - stopped).toBe(16);
    expect(speeds.slice(stopped, reverse).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(bike.fallen).toBe(false);
  });

  it('(5) a speed of -1e-16 after a hit is rounding noise: it does not start the reverse without the wait', () => {
    expect(nextSpeed(-1e-16, 0, 1, 15, null, H, T, 0)).toBe(0);
    expect(nextSpeed(-1e-12, 0, 1, 15, null, H, T, 0)).toBe(0);
    // A real reverse (at -1e-6 and more) goes on, with or without the wait.
    expect(nextSpeed(-1e-6, 0, 1, 15, null, H, T, 0)).toBeLessThan(-1e-6);
  });
});

describe('the wait in the predictor and on the server', () => {
  it('(8) the same controls give the same pose on the server world and the predictor, through the wait and a second wait', () => {
    const START = { x: 0, y: 0, heading: 0.4 };
    const control = (t: number): BikeControl => ({
      // brake 0..59, let go 60..79, brake again 80..199: two waits, two reverses
      throttle: 0,
      brake: t < 60 || t >= 80 ? 1 : 0,
      steer: Math.round(Math.sin(t / 20) * 2) / 2,
      seq: t,
    });
    const server = createWorld();
    addBike(server, 0, START);
    const predictor = new Predictor(0, START);
    let reversed = 0;
    for (let t = 0; t < 200; t++) {
      const c = control(t);
      stepPhysics(server, { tick: t, dt: DT, bikes: [{ player: 0, speedFactor: 1, control: c }], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [] }, STAGES);
      predictor.step(c);
      const sb = server.bikes.get(0)!;
      expect(predictor.bike.x).toBe(sb.x);
      expect(predictor.bike.y).toBe(sb.y);
      expect(predictor.bike.speed).toBe(sb.speed);
      if (sb.speed < 0) reversed++;
    }
    expect(reversed).toBeGreaterThan(20);
  });

  it('(8) the same input twice gives the same result (JSON of the whole run)', () => {
    const run = () => {
      const world = standing();
      const outs = [];
      for (let t = 0; t < 120; t++) outs.push(tick(world, t, { brake: t % 70 < 50 ? 1 : 0, steer: 0.3 }));
      return JSON.stringify(outs);
    };
    expect(run()).toBe(run());
  });
});
