import { describe, expect, it } from 'vitest';
import {
  addBike,
  COLLIDE_STAGES,
  createWorld,
  EMPTY_STAGES,
  stepPhysics,
  type PhysicsInput,
  type PhysicsStages,
  type PhysicsWorld,
  type SubstepContext,
} from '../../../src/physics';
import { BIKE_RADIUS_M, MAX_CONTACTS_PER_BIKE, OUTER_WALL_MARGIN_M } from '../../../src/physics/collide/constants';
import { candidatesOf, solveBike } from '../../../src/physics/collide/stages';
import { FakeM1 } from '../../fakes/fakeM1';

const STAGES: PhysicsStages = { ...EMPTY_STAGES, ...COLLIDE_STAGES };
const FALL = 6; // default physics.fall_speed_mps

// A building to the east of x = 10: x from 10 to 20, y from -5 to 5.
const BUILDING = [{ x: 10, y: -5 }, { x: 20, y: -5 }, { x: 20, y: 5 }, { x: 10, y: 5 }];

function input(over: Partial<PhysicsInput> = {}): PhysicsInput {
  return { tick: 0, dt: 1 / 30, bikes: [], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [], ...over };
}

/** A world with the building and one bike that overlaps the west face by 0.3 m, driving east. */
function setup(speed: number, heading = 0) {
  const world = createWorld();
  world.buildings = [BUILDING];
  const bike = addBike(world, 0, { x: 10 - BIKE_RADIUS_M + 0.3, y: 0, heading });
  bike.speed = speed;
  return { world, bike };
}

describe('buildings: fall or bump', () => {
  it('a hit above the fall speed makes the motorcycle fall', () => {
    const { world, bike } = setup(8);
    const out = stepPhysics(world, input(), STAGES);
    expect(bike.fallen).toBe(true);
    expect(bike.speed).toBe(0);
    expect(bike.slip).toBe(0);
    expect(out.events).toEqual([
      { kind: 'collision', player: 0, with: 'building', other: null, impactSpeed: 8 },
      { kind: 'fall', player: 0, cause: 'building', impactSpeed: 8 },
    ]);
  });

  it('a slow hit does not make it fall, it stops the motorcycle and pushes it out', () => {
    const { world, bike } = setup(4);
    const out = stepPhysics(world, input(), STAGES);
    expect(bike.fallen).toBe(false);
    expect(bike.speed).toBeCloseTo(0, 9);
    expect(bike.x).toBeLessThan(10 - BIKE_RADIUS_M + 1e-9);
    expect(out.events).toEqual([{ kind: 'collision', player: 0, with: 'building', other: null, impactSpeed: 4 }]);
    expect(out.events[0].kind === 'collision' && out.events[0].impactSpeed).toBeLessThan(FALL);
  });

  it('a hit exactly at the fall speed is only a bump', () => {
    const { world, bike } = setup(FALL);
    const out = stepPhysics(world, input(), STAGES);
    expect(bike.fallen).toBe(false);
    expect(out.events.map((e) => e.kind)).toEqual(['collision']);
  });

  it('follows the fall speed that the admin sets', () => {
    const { world, bike } = setup(8);
    world.params.fallSpeed = 9;
    stepPhysics(world, input(), STAGES);
    expect(bike.fallen).toBe(false);
  });

  it('a scrape along the wall keeps its speed and gives no event', () => {
    const { world, bike } = setup(10, Math.PI / 2); // driving north, the wall is on the east
    const out = stepPhysics(world, input(), STAGES);
    expect(bike.fallen).toBe(false);
    expect(bike.speed).toBeCloseTo(10, 9);
    expect(bike.x).toBeLessThanOrEqual(10 - BIKE_RADIUS_M);
    expect(out.events).toEqual([]);
  });

  it('a hit at an angle only counts the part into the wall', () => {
    const { world } = setup(0);
    const bike = world.bikes.get(0)!;
    bike.heading = Math.PI / 4;
    bike.speed = 8;
    const out = stepPhysics(world, input(), STAGES);
    const e = out.events[0];
    expect(e.kind === 'collision' && e.impactSpeed).toBeCloseTo(8 * Math.SQRT1_2, 9);
  });
});

describe('outer wall', () => {
  function walled(): { world: PhysicsWorld } {
    const world = createWorld();
    world.bounds = { minX: 0, maxX: 100, minY: -100, maxY: 0 };
    return { world };
  }
  const face = 100 + OUTER_WALL_MARGIN_M;

  it('a fast hit on the outer wall is a fall with cause wall', () => {
    const { world } = walled();
    const bike = addBike(world, 0, { x: face - BIKE_RADIUS_M + 0.3, y: -50, heading: 0 });
    bike.speed = 9;
    const out = stepPhysics(world, input(), STAGES);
    expect(bike.fallen).toBe(true);
    expect(out.events).toEqual([
      { kind: 'collision', player: 0, with: 'wall', other: null, impactSpeed: 9 },
      { kind: 'fall', player: 0, cause: 'wall', impactSpeed: 9 },
    ]);
  });

  it('every side holds a slow motorcycle inside, even far beyond the face', () => {
    const { world } = walled();
    const spots = [
      { x: 140, y: -50 }, { x: -40, y: -50 }, { x: 50, y: 40 }, { x: 50, y: -140 },
    ];
    spots.forEach((p, i) => {
      const b = addBike(world, i, { x: p.x, y: p.y, heading: 0 });
      b.speed = 1;
    });
    stepPhysics(world, input(), STAGES);
    for (const b of world.bikes.values()) {
      expect(b.x).toBeLessThanOrEqual(face - BIKE_RADIUS_M + 1e-9);
      expect(b.x).toBeGreaterThanOrEqual(-OUTER_WALL_MARGIN_M + BIKE_RADIUS_M - 1e-9);
      expect(b.y).toBeLessThanOrEqual(OUTER_WALL_MARGIN_M - BIKE_RADIUS_M + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(-100 - OUTER_WALL_MARGIN_M + BIKE_RADIUS_M - 1e-9);
    }
  });

  it('no bounds means no outer wall', () => {
    const world = createWorld();
    const bike = addBike(world, 0, { x: 5000, y: 5000, heading: 0 });
    bike.speed = 20;
    const out = stepPhysics(world, input(), STAGES);
    expect(out.events).toEqual([]);
    expect(bike.x).toBe(5000);
  });
});

describe('fallen motorcycles', () => {
  it('a fallen motorcycle is not solid: no push, no event', () => {
    const { world, bike } = setup(0);
    bike.fallen = true;
    const out = stepPhysics(world, input(), STAGES);
    expect(out.events).toEqual([]);
    expect(bike.x).toBeCloseTo(10 - BIKE_RADIUS_M + 0.3, 12);
  });

  it('a motorcycle that M1 drops (input.fall) gives no collision and no fall event', () => {
    const { world, bike } = setup(8);
    const out = stepPhysics(world, input({ fall: [0] }), STAGES);
    expect(bike.fallen).toBe(true);
    expect(out.events).toEqual([]);
  });

  it('after the fall it stays down in the second substep and gives no second fall event', () => {
    const { world } = setup(8);
    const out = stepPhysics(world, input(), STAGES);
    expect(out.events.filter((e) => e.kind === 'fall')).toHaveLength(1);
  });
});

describe('one collision event per tick', () => {
  /** In the second substep the motorcycle is put back into the wall with another speed. */
  function twoHits(first: number, second: number) {
    const { world, bike } = setup(first);
    const stages: PhysicsStages = {
      ...STAGES,
      wallsAndObstacles: (ctx) => {
        if (ctx.substep === 1) {
          bike.x = 10 - BIKE_RADIUS_M + 0.3;
          bike.y = 0;
          bike.speed = second;
        }
        COLLIDE_STAGES.wallsAndObstacles(ctx);
      },
    };
    return stepPhysics(world, input(), stages);
  }

  it('two hits in two substeps are one event with the larger impact speed', () => {
    for (const [a, b] of [[4, 5], [5, 4]]) {
      const out = twoHits(a, b);
      expect(out.events).toEqual([{ kind: 'collision', player: 0, with: 'building', other: null, impactSpeed: 5 }]);
    }
  });

  it('a fall in the second substep is still one collision event plus the fall', () => {
    const out = twoHits(3, 7);
    expect(out.events).toEqual([
      { kind: 'collision', player: 0, with: 'building', other: null, impactSpeed: 7 },
      { kind: 'fall', player: 0, cause: 'building', impactSpeed: 7 },
    ]);
  });
});

describe('FakeM1 with the real city plan', () => {
  // Player 0 starts at the blue store (x 18, y -18) heading east. The first building has a face at x = 30 from y -30 to -10.
  function ride() {
    const fake = new FakeM1({ seed: 1, players: [0], control: () => ({ throttle: 1 }) });
    const ticks = fake.run(200);
    return { fake, ticks };
  }

  it('the city plan fills the buildings and the bounds', () => {
    const fake = new FakeM1({ seed: 1, players: [0], control: () => ({}) });
    expect(fake.physics.buildings.length).toBe(25);
    expect(fake.physics.bounds).toEqual({ minX: 0, maxX: 500, minY: -500, maxY: 0 });
  });

  it('a motorcycle that drives into a building corner hits it and never gets inside', () => {
    const { ticks } = ride();
    const events = ticks.flatMap((t) => t.physics.events);
    expect(events.some((e) => e.kind === 'collision' && e.with === 'building')).toBe(true);
    for (const t of ticks) {
      for (const b of t.physics.bikes) expect(b.x).toBeLessThanOrEqual(30 - BIKE_RADIUS_M + 1e-3);
    }
    for (const e of events) if (e.kind === 'fall') expect(e.impactSpeed).toBeGreaterThan(FALL);
  });

  it('the same input gives the same result', () => {
    const a = JSON.stringify(ride().ticks);
    const b = JSON.stringify(ride().ticks);
    expect(a).toBe(b);
  });
});

describe('limit of contacts per motorcycle', () => {
  // A vise: buildings on the west of x = 10 and on the east of x = 11. The gap (1 m) is
  // narrower than the motorcycle (1.2 m), so every push into one side goes into the other.
  const west = [{ x: 0, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
  const east = [{ x: 11, y: -5 }, { x: 21, y: -5 }, { x: 21, y: 5 }, { x: 11, y: 5 }];

  function vise(sidesEach: number) {
    const world = createWorld();
    // West and east alternate in the list, so each push is followed by a contact on the other side.
    world.buildings = Array.from({ length: sidesEach * 2 }, (_, i) => (i % 2 === 0 ? west : east));
    const bike = addBike(world, 0, { x: 10.5, y: 0, heading: 0 });
    return { world, bike };
  }
  const ctxOf = (world: PhysicsWorld): SubstepContext => ({
    world, input: input(), h: 1 / 60, substep: 0, controls: new Map(), turn: new Map(), events: [], carHits: [],
  });

  it('stops at MAX_CONTACTS_PER_BIKE contacts and ends, instead of looping', () => {
    const { world, bike } = vise(20);
    const resolved = solveBike(ctxOf(world), bike, candidatesOf(world));
    expect(resolved).toBe(MAX_CONTACTS_PER_BIKE);
    expect(Number.isFinite(bike.x)).toBe(true);
  });

  it('a few contacts are all resolved, below the limit', () => {
    const { world, bike } = vise(2);
    const resolved = solveBike(ctxOf(world), bike, candidatesOf(world));
    expect(resolved).toBeGreaterThan(0);
    expect(resolved).toBeLessThanOrEqual(4);
  });

  it('a whole tick in the vise ends and the leftover is not lost: the motorcycle stays in the gap', () => {
    const { world, bike } = vise(20);
    stepPhysics(world, input(), STAGES);
    expect(bike.x).toBeGreaterThan(9);
    expect(bike.x).toBeLessThan(12);
  });
});
