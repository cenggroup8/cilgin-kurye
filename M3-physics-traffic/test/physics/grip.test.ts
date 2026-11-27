import { describe, expect, it } from 'vitest';
import {
  addBike,
  applyGrip,
  BIKE_STAGES,
  createWorld,
  EMPTY_STAGES,
  stepPhysics,
  type BikeState,
  type PhysicsWorld,
  type SurfaceProvider,
} from '../../src/physics/index.js';

const DT = 1 / 30;
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };

/** Ground with a fixed grip everywhere (stands in for the colliders of M3-2). */
const groundWithGrip = (grip: number): SurfaceProvider => () => ({ grip, speedCap: null });

function setup(speed: number, grip?: number): PhysicsWorld {
  const world = createWorld();
  if (grip !== undefined) world.surfaceAt = groundWithGrip(grip);
  addBike(world, 0, { x: 0, y: 0, heading: 0 }).speed = speed;
  return world;
}

/** Holds the speed and steers for some ticks. */
function ride(world: PhysicsWorld, ticks: number, steer: number, speedFactor = 1, each?: (b: BikeState) => void): BikeState {
  const bike = world.bikes.get(0)!;
  const hold = bike.speed;
  for (let t = 0; t < ticks; t++) {
    const throttle = bike.speed < hold ? 1 : 0;
    stepPhysics(
      world,
      {
        tick: t, dt: DT, obstacles: [], npcCars: [], quake: null, fall: [], standUp: [],
        bikes: [{ player: 0, speedFactor, control: { throttle, brake: 0, steer, seq: t } }],
      },
      STAGES,
    );
    each?.(bike);
  }
  return bike;
}

describe('grip and sliding', () => {
  it('follows the turn on a normal road at normal speed', () => {
    let slid = false;
    const bike = ride(setup(8), 60, 1, 1, (b) => (slid ||= b.sliding));
    expect(slid).toBe(false);
    expect(bike.slip).toBe(0);
  });

  it('slides out of the turn when it is too fast for the grip', () => {
    let slid = false;
    const bike = ride(setup(20), 30, 1, 1.5, (b) => (slid ||= b.sliding));
    expect(slid).toBe(true);
    // A right turn slides out to the left: positive side speed.
    expect(bike.slip).toBeGreaterThan(0);
  });

  it('turns less and slides on a puddle where the normal road holds', () => {
    const road = ride(setup(12), 30, 1);
    const puddle = ride(setup(12, 0.4), 30, 1);
    expect(road.sliding).toBe(false);
    expect(puddle.sliding).toBe(true);
    // Less heading change on the puddle: the real path is wider.
    expect(Math.abs(puddle.heading)).toBeLessThan(Math.abs(road.heading));
  });

  it('does not slow down on a puddle', () => {
    const world = setup(12, 0.4);
    const ref = setup(12);
    ride(world, 30, 1);
    ride(ref, 30, 1);
    expect(world.bikes.get(0)!.speed).toBe(ref.bikes.get(0)!.speed);
  });

  it('slides the same way to the left and to the right', () => {
    const right = ride(setup(12, 0.4), 30, 1);
    const left = ride(setup(12, 0.4), 30, -1);
    expect(left.slip).toBeCloseTo(-right.slip, 9);
    expect(left.y).toBeCloseTo(-right.y, 9);
  });

  it('the slide fades away when the grip is back', () => {
    const world = setup(12, 0.4);
    ride(world, 30, 1);
    expect(world.bikes.get(0)!.sliding).toBe(true);
    world.surfaceAt = groundWithGrip(1);
    const bike = ride(world, 30, 0);
    expect(bike.slip).toBe(0);
    expect(bike.sliding).toBe(false);
  });
});

describe('applyGrip', () => {
  it('keeps the wanted turn below the limit and cuts it above', () => {
    expect(applyGrip(10, 0.5, 0, 1, DT / 2).turn).toBe(0.5);
    const cut = applyGrip(10, 2, 0, 1, DT / 2);
    expect(cut.turn).toBeCloseTo((1 * 9.81) / 10, 12);
    expect(cut.slip).toBeLessThan(0);
  });
});
