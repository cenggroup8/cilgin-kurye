import { describe, expect, it } from 'vitest';
import {
  addBike,
  BIKE_STAGES,
  createWorld,
  DEFAULT_BIKE_TUNING,
  EMPTY_STAGES,
  stepPhysics,
  wantedTurnRate,
  type BikeState,
  type PhysicsInput,
  type PhysicsWorld,
} from '../../src/physics/index.js';

const DT = 1 / 30;
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };

interface Ctl {
  throttle?: number;
  brake?: number;
  steer?: number;
}

/** Drives player 0 for some ticks; `ctl` can look at the motorcycle to decide. */
function drive(
  world: PhysicsWorld,
  ticks: number,
  ctl: (bike: BikeState, tick: number) => Ctl,
  speedFactor = 1,
  each?: (bike: BikeState) => void,
): BikeState {
  const bike = world.bikes.get(0)!;
  for (let t = 0; t < ticks; t++) {
    const c = ctl(bike, t);
    const input: PhysicsInput = {
      tick: t,
      dt: DT,
      bikes: [{ player: 0, speedFactor, control: { throttle: c.throttle ?? 0, brake: c.brake ?? 0, steer: c.steer ?? 0, seq: t } }],
      obstacles: [],
      npcCars: [],
      quake: null,
      fall: [],
      standUp: [],
    };
    stepPhysics(world, input, STAGES);
    each?.(bike);
  }
  return bike;
}

function worldWithBike(speed = 0): PhysicsWorld {
  const world = createWorld();
  addBike(world, 0, { x: 0, y: 0, heading: 0 }).speed = speed;
  return world;
}

describe('speed', () => {
  it('a straight run with full throttle gets close to the top speed and never above it', () => {
    let max = 0;
    const bike = drive(worldWithBike(), 30 * 20, () => ({ throttle: 1 }), 1, (b) => (max = Math.max(max, b.speed)));
    expect(bike.speed).toBeGreaterThan(0.9 * 15);
    expect(max).toBeLessThanOrEqual(15);
    expect(bike.x).toBeGreaterThan(200);
    expect(bike.y).toBe(0);
    expect(bike.heading).toBe(0);
  });

  // Changed for the small reverse (reverse.test.ts): the brake is let go at the reverse threshold (0.05 m/s), so this only tests braking from speed.
  it('the brake stops a moving motorcycle without going backwards', () => {
    let lastX = 0;
    let backwards = 0;
    // The brake is held for the whole tick, so the second substep can already begin the reverse: at most a few millimetres.
    const bike = drive(worldWithBike(15), 30 * 5, (b) => ({ brake: b.speed > 0.05 ? 1 : 0 }), 1, (b) => {
      backwards = Math.max(backwards, lastX - b.x);
      lastX = b.x;
    });
    expect(bike.speed).toBeLessThanOrEqual(0.05);
    expect(bike.speed).toBeGreaterThanOrEqual(-0.1);
    expect(backwards).toBeLessThan(0.005);
    // From 15 m/s the full brake needs about one second and about 11 m.
    expect(bike.x).toBeLessThan(15);
  });

  it('without throttle the air drag slows the motorcycle down slowly', () => {
    const bike = drive(worldWithBike(10), 30, () => ({}));
    expect(bike.speed).toBeLessThan(10);
    expect(bike.speed).toBeGreaterThan(8);
  });

  it('the speed factor of a player changes the top speed', () => {
    const bike = drive(worldWithBike(), 30 * 20, () => ({ throttle: 1 }), 0.5);
    expect(bike.speed).toBeGreaterThan(0.9 * 7.5);
    expect(bike.speed).toBeLessThanOrEqual(7.5);
  });

  it('an accident slow zone brakes the motorcycle down to the cap', () => {
    const world = worldWithBike(15);
    world.surfaceAt = (_x, _y, p) => ({ grip: p.grip, speedCap: 6 });
    const bike = drive(world, 30 * 2, () => ({ throttle: 1 }));
    expect(bike.speed).toBeLessThanOrEqual(6);
    expect(bike.speed).toBeGreaterThan(5.5);
  });
});

describe('steering', () => {
  it('a U turn at low speed fits on the road', () => {
    // Hold about 3 m/s and steer fully right until the heading has turned half a circle.
    const world = worldWithBike(3);
    let turned = 0;
    let last = 0;
    let minY = 0;
    const bike = world.bikes.get(0)!;
    for (let t = 0; t < 30 * 20 && turned < Math.PI; t++) {
      drive(world, 1, (b) => ({ throttle: b.speed < 3 ? 1 : 0, steer: 1 }));
      let d = bike.heading - last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      turned += -d;
      last = bike.heading;
      minY = Math.min(minY, bike.y);
    }
    expect(turned).toBeGreaterThanOrEqual(Math.PI);
    // Steering right from heading +x goes to -y. The road has 4 lanes of 3.5 m = 14 m.
    expect(minY).toBeLessThan(0);
    expect(-minY).toBeLessThan(7);
  });

  it('turns tight at low speed and wide at high speed', () => {
    const radius = (v: number) => v / Math.abs(wantedTurnRate(v, 1, DEFAULT_BIKE_TUNING));
    expect(radius(2)).toBeLessThan(3);
    expect(radius(12)).toBeGreaterThan(4 * radius(3));
    expect(Math.abs(wantedTurnRate(0, 1, DEFAULT_BIKE_TUNING))).toBe(0);
  });

  it('left and right act the same, and the lean shows the side of the turn', () => {
    const right = drive(worldWithBike(8), 30, () => ({ throttle: 0.5, steer: 1 }));
    const left = drive(worldWithBike(8), 30, () => ({ throttle: 0.5, steer: -1 }));
    expect(right.y).toBeLessThan(0);
    expect(left.y).toBeCloseTo(-right.y, 9);
    expect(left.x).toBeCloseTo(right.x, 9);
    expect(right.lean).toBeGreaterThan(0);
    expect(left.lean).toBeCloseTo(-right.lean, 9);
    expect(Math.abs(right.lean)).toBeLessThanOrEqual(DEFAULT_BIKE_TUNING.maxLean);
  });
});

describe('the motorcycle model', () => {
  it('does not move a fallen motorcycle', () => {
    const world = worldWithBike(10);
    world.bikes.get(0)!.fallen = true;
    const bike = drive(world, 30, () => ({ throttle: 1, steer: 1 }));
    expect([bike.x, bike.y, bike.heading]).toEqual([0, 0, 0]);
  });

  it('gives exactly the same result for the same inputs', () => {
    const ctl = (_b: BikeState, t: number): Ctl => ({ throttle: t % 50 < 30 ? 1 : 0, brake: t % 70 > 60 ? 1 : 0, steer: Math.sin(t / 20) });
    const a = drive(worldWithBike(), 900, ctl);
    const b = drive(worldWithBike(), 900, ctl);
    expect(a).toEqual(b);
  });
});
