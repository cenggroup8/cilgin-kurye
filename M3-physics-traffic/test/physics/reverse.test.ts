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
import { nextSpeed } from '../../src/physics/bike/model.js';
import { BIKE_RADIUS_M } from '../../src/physics/collide/constants.js';
import { FakeM1 } from '../fakes/fakeM1.js';

const DT = 1 / 30;
const H = DT / 2; // one substep
const T = DEFAULT_BIKE_TUNING;
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };
const FALL = 6;

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
    expect(nextSpeed(0, 0, 1, 15, null, H, T)).toBeCloseTo(-T.reverseAccel * H, 12);
    expect(nextSpeed(0, 0, 0.5, 15, null, H, T)).toBeCloseTo(-0.5 * T.reverseAccel * H, 12);
  });

  it('never goes below -reverseMax', () => {
    let v = 0;
    for (let i = 0; i < 1000; i++) {
      v = nextSpeed(v, 0, 1, 15, null, H, T);
      expect(v).toBeGreaterThanOrEqual(-T.reverseMax);
    }
    expect(v).toBe(-T.reverseMax);
  });

  it('forward braking only stops: it never jumps below 0 in one step', () => {
    let v = 15;
    for (let i = 0; i < 200 && v > 0; i++) {
      const next = nextSpeed(v, 0, 1, 15, null, H, T);
      // From above the threshold it is cut at 0; below it the reverse starts, by at most one small step.
      expect(next).toBeGreaterThanOrEqual(v > T.reverseEnterSpeed ? 0 : -T.reverseAccel * H);
      v = next;
    }
    expect(v).toBeLessThanOrEqual(0);
    expect(v).toBeGreaterThanOrEqual(-T.reverseAccel * H);
  });

  it('reverse does not start above reverseEnterSpeed', () => {
    expect(nextSpeed(T.reverseEnterSpeed + 0.01, 0, 1, 15, null, H, T)).toBeGreaterThanOrEqual(0);
    expect(nextSpeed(T.reverseEnterSpeed, 0, 1, 15, null, H, T)).toBeLessThan(T.reverseEnterSpeed);
  });

  it('with throttle the brake does not reverse', () => {
    expect(nextSpeed(0, 0.2, 1, 15, null, H, T)).toBeGreaterThanOrEqual(0);
  });

  it('a reversing motorcycle goes back to 0 with the brake deceleration and not past it, when the brake is let go or throttle is given', () => {
    expect(nextSpeed(-2, 0, 0, 15, null, H, T)).toBeCloseTo(-2 + T.brake * H, 12);
    expect(nextSpeed(-2, 1, 0, 15, null, H, T)).toBeCloseTo(-2 + T.brake * H, 12);
    expect(nextSpeed(-0.1, 0, 0, 15, null, H, T)).toBe(0);
    expect(nextSpeed(-0.1, 1, 0, 15, null, H, T)).toBe(0);
  });

  it('the speed cap of an accident zone only touches forward speed', () => {
    expect(nextSpeed(-2, 0, 1, 15, 5, H, T)).toBeLessThan(-2);
    expect(nextSpeed(10, 0, 0, 15, 5, H, T)).toBeLessThan(10);
  });
});

describe('reverse in the world', () => {
  it('a standing motorcycle with the brake: the speed gets negative, the first substep is at most reverseAccel x h, never below -reverseMax', () => {
    const world = standing();
    let min = 0;
    let first = 0;
    ride(world, 30 * 5, () => ({ brake: 1 }), (b) => {
      if (first === 0) first = b.speed;
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
