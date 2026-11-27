import { describe, expect, it } from 'vitest';
import {
  addBike,
  COLLIDE_STAGES,
  createWorld,
  EMPTY_STAGES,
  stepPhysics,
  type PhysicsEvent,
  type PhysicsInput,
  type PhysicsStages,
  type PhysicsWorld,
} from '../../../src/physics';
import { CAR_HIT_MIN_MPS } from '../../../src/physics/collide/constants';
import type { NpcCarPose, NpcState } from '../../../src/traffic/npc/types';
import { FakeM1 } from '../../fakes/fakeM1';

const STAGES: PhysicsStages = { ...EMPTY_STAGES, ...COLLIDE_STAGES };
const FALL = 6; // default physics.fall_speed_mps
const CAR_HALF_LENGTH = 2.25;

function car(id: number, x: number, y: number, heading: number, speed = 0, state: NpcState = 'driving'): NpcCarPose {
  return { id, x, y, heading, speed, edgeId: null, lane: 0, length: 4.5, width: 1.8, state };
}

function input(over: Partial<PhysicsInput> = {}): PhysicsInput {
  return { tick: 0, dt: 1 / 30, bikes: [], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [], ...over };
}

function step(world: PhysicsWorld, cars: NpcCarPose[], over: Partial<PhysicsInput> = {}, stages = STAGES) {
  return stepPhysics(world, input({ npcCars: cars, ...over }), stages);
}

const kinds = (events: PhysicsEvent[]) => events.map((e) => (e.kind === 'collision' ? `collision:${e.player}:${e.with}:${e.other}` : `fall:${e.player}:${e.cause}`));
const impactOf = (events: PhysicsEvent[], i = 0) => events[i].impactSpeed;

/** The car stands at (0, 0) heading east. A bike, facing west, overlaps its front by 0.3 m and drives into it. */
function front(speed: number, carSpeed = 0) {
  const world = createWorld();
  const bike = addBike(world, 0, { x: CAR_HALF_LENGTH + 0.6 - 0.3, y: 0, heading: Math.PI });
  bike.speed = speed;
  return { world, bike, cars: [car(7, 0, 0, 0, carSpeed)] };
}

describe('motorcycle against an NPC car', () => {
  it('a hit above the fall speed: collision, fall, CarHit', () => {
    const { world, bike, cars } = front(8);
    const out = step(world, cars);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7', 'fall:0:npc']);
    expect(impactOf(out.events, 0)).toBeCloseTo(8, 9);
    expect(impactOf(out.events, 1)).toBeCloseTo(8, 9);
    expect(bike.fallen).toBe(true);
    expect(bike.speed).toBe(0);
    expect(out.carHits).toHaveLength(1);
    expect(out.carHits[0].carId).toBe(7);
    expect(out.carHits[0].impactSpeed).toBeCloseTo(8, 9);
  });

  it('a hit below the fall speed is a bump: the motorcycle stops (the car stands), the car still gets a CarHit', () => {
    const { world, bike, cars } = front(4);
    const out = step(world, cars);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7']);
    expect(bike.fallen).toBe(false);
    expect(bike.speed).toBeCloseTo(0, 9);
    expect(bike.x).toBeGreaterThanOrEqual(CAR_HALF_LENGTH + 0.6);
    expect(out.carHits).toEqual([{ carId: 7, impactSpeed: expect.closeTo(4, 9) }]);
  });

  it('a hit exactly at the fall speed does not make it fall', () => {
    const { world, bike, cars } = front(FALL);
    const out = step(world, cars);
    expect(bike.fallen).toBe(false);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7']);
  });

  it('a turned car: front hit and side hit both count along the normal', () => {
    // Car heading north: front face at y = 2.25, side face at x = 0.9.
    const w1 = createWorld();
    const b1 = addBike(w1, 0, { x: 0, y: CAR_HALF_LENGTH + 0.3, heading: -Math.PI / 2 });
    b1.speed = 8;
    const o1 = step(w1, [car(1, 0, 0, Math.PI / 2)]);
    expect(kinds(o1.events)).toEqual(['collision:0:npc:1', 'fall:0:npc']);
    expect(impactOf(o1.events)).toBeCloseTo(8, 9);

    const w2 = createWorld();
    const b2 = addBike(w2, 0, { x: 0.9 + 0.3, y: 0, heading: Math.PI });
    b2.speed = 8;
    const o2 = step(w2, [car(1, 0, 0, Math.PI / 2)]);
    expect(kinds(o2.events)).toEqual(['collision:0:npc:1', 'fall:0:npc']);
    expect(impactOf(o2.events)).toBeCloseTo(8, 9);
  });

  it('a stopped car is solid', () => {
    const { world, bike, cars } = front(8);
    cars[0].state = 'stopped';
    const out = step(world, cars);
    expect(bike.fallen).toBe(true);
    expect(out.carHits).toHaveLength(1);
  });

  it('a car that drives into a standing motorcycle: the relative speed counts, the motorcycle is pushed along', () => {
    const world = createWorld();
    const bike = addBike(world, 0, { x: CAR_HALF_LENGTH + 0.3, y: 0, heading: 0 });
    const fast = step(world, [car(3, 0, 0, 0, 10)]);
    expect(kinds(fast.events)).toEqual(['collision:0:npc:3', 'fall:0:npc']);
    expect(fast.carHits[0].impactSpeed).toBeCloseTo(10, 9);
    expect(bike.fallen).toBe(true);

    const w2 = createWorld();
    const b2 = addBike(w2, 0, { x: CAR_HALF_LENGTH + 0.3, y: 0, heading: 0 });
    const slow = step(w2, [car(3, 0, 0, 0, 5)]);
    expect(kinds(slow.events)).toEqual(['collision:0:npc:3']);
    expect(b2.fallen).toBe(false);
    expect(b2.speed).toBeCloseTo(5, 9); // goes on with the speed of the car
  });

  it('a slow scrape in the same direction: a bump, no fall, no CarHit (below CAR_HIT_MIN_MPS)', () => {
    const world = createWorld();
    const bike = addBike(world, 0, { x: -CAR_HALF_LENGTH - 0.6 + 0.05, y: 0, heading: 0 });
    bike.speed = 5.5;
    const out = step(world, [car(2, 0, 0, 0, 5)]);
    expect(kinds(out.events)).toEqual(['collision:0:npc:2']);
    expect(impactOf(out.events)).toBeCloseTo(0.5, 9);
    expect(out.carHits).toEqual([]);
    expect(bike.fallen).toBe(false);
    expect(0.5).toBeLessThan(CAR_HIT_MIN_MPS);
  });

  it('side by side at the same speed: no event and no CarHit, but they are pushed apart', () => {
    const world = createWorld();
    const bike = addBike(world, 0, { x: 0, y: 0.9 + 0.6 - 0.1, heading: 0 });
    bike.speed = 5;
    const out = step(world, [car(2, 0, 0, 0, 5)]);
    expect(out.events).toEqual([]);
    expect(out.carHits).toEqual([]);
    expect(bike.y).toBeGreaterThanOrEqual(0.9 + 0.6);
    expect(bike.speed).toBeCloseTo(5, 9);
  });

  it('an off road car is solid, but it gets no CarHit', () => {
    const { world, bike, cars } = front(8);
    cars[0].state = 'offroad';
    const out = step(world, cars);
    expect(bike.fallen).toBe(true);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7', 'fall:0:npc']);
    expect(out.carHits).toEqual([]);
  });

  it('a hit below 1 m/s gives an event but no CarHit', () => {
    const { world, cars } = front(0.5);
    const out = step(world, cars);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7']);
    expect(out.carHits).toEqual([]);
  });

  it('a fallen motorcycle drives through the car: no push, no event, no CarHit', () => {
    const { world, bike, cars } = front(8);
    bike.fallen = true;
    const x = bike.x;
    const out = step(world, cars);
    expect(out.events).toEqual([]);
    expect(out.carHits).toEqual([]);
    expect(bike.x).toBe(x);
  });

  it('a motorcycle that M1 drops (input.fall) gives no event', () => {
    const { world, cars } = front(8);
    const out = step(world, cars, { fall: [0] });
    expect(out.events).toEqual([]);
    expect(out.carHits).toEqual([]);
  });

  it('the order of the cars in the input does not change the result', () => {
    const run = (order: number[]) => {
      const world = createWorld();
      const bike = addBike(world, 0, { x: CAR_HALF_LENGTH + 0.3, y: 0.5, heading: Math.PI });
      bike.speed = 4;
      const cars = [car(5, 0, 0, 0, 0), car(2, 1.5, 1.9, 0.3, 0), car(9, 6, 0, 0, 0)];
      return JSON.stringify(step(world, order.map((i) => cars[i])));
    };
    expect(run([0, 1, 2])).toBe(run([2, 1, 0]));
    expect(run([0, 1, 2])).toBe(run([1, 2, 0]));
  });
});

describe('CarHit and events over two substeps and several motorcycles', () => {
  /** In the second substep the bike is put back into the car with another speed. */
  function twoHits(first: number, second: number) {
    const { world, bike, cars } = front(first);
    const stages: PhysicsStages = {
      ...STAGES,
      carsAndBikes: (ctx) => {
        if (ctx.substep === 1) {
          bike.x = CAR_HALF_LENGTH + 0.3;
          bike.y = 0;
          bike.speed = second;
          bike.heading = Math.PI;
        }
        COLLIDE_STAGES.carsAndBikes(ctx);
      },
    };
    return step(world, cars, {}, stages);
  }

  it('one CarHit per car with the largest speed, and one collision event, in both orders', () => {
    for (const [a, b] of [[3, 5], [5, 3]]) {
      const out = twoHits(a, b);
      expect(out.carHits).toEqual([{ carId: 7, impactSpeed: expect.closeTo(5, 9) }]);
      expect(kinds(out.events)).toEqual(['collision:0:npc:7']);
      expect(impactOf(out.events)).toBeCloseTo(5, 9);
    }
  });

  it('a fall in the second substep gives the collision event with the larger speed and the fall', () => {
    const out = twoHits(3, 7);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7', 'fall:0:npc']);
    expect(impactOf(out.events, 0)).toBeCloseTo(7, 9);
    expect(out.carHits).toEqual([{ carId: 7, impactSpeed: expect.closeTo(7, 9) }]);
  });

  it('two motorcycles that hit the same car in one tick give one CarHit with the larger speed', () => {
    const world = createWorld();
    const b0 = addBike(world, 0, { x: CAR_HALF_LENGTH + 0.3, y: 0, heading: Math.PI });
    b0.speed = 3;
    const b1 = addBike(world, 1, { x: -CAR_HALF_LENGTH - 0.3, y: 0, heading: 0 });
    b1.speed = 4;
    const out = step(world, [car(7, 0, 0, 0)]);
    expect(out.carHits).toEqual([{ carId: 7, impactSpeed: expect.closeTo(4, 9) }]);
    expect(kinds(out.events)).toEqual(['collision:0:npc:7', 'collision:1:npc:7']);
  });
});

describe('motorcycle against motorcycle', () => {
  function pair(speedA: number, speedB: number, gap = 1.0) {
    const world = createWorld();
    const a = addBike(world, 0, { x: 0, y: 0, heading: 0 }); // drives east
    a.speed = speedA;
    const b = addBike(world, 1, { x: gap, y: 0, heading: Math.PI }); // drives west
    b.speed = speedB;
    return { world, a, b };
  }

  it('above the fall speed both fall, cause bike, one event for each', () => {
    const { world, a, b } = pair(4, 4);
    const out = step(world, []);
    expect(kinds(out.events)).toEqual(['collision:0:bike:1', 'collision:1:bike:0', 'fall:0:bike', 'fall:1:bike']);
    for (const e of out.events) expect(e.impactSpeed).toBeCloseTo(8, 9);
    expect(a.fallen && b.fallen).toBe(true);
    expect(b.x - a.x).toBeGreaterThanOrEqual(1.2);
  });

  it('below the fall speed none falls and each loses half of the closing speed', () => {
    const { world, a, b } = pair(2, 2);
    const out = step(world, []);
    expect(kinds(out.events)).toEqual(['collision:0:bike:1', 'collision:1:bike:0']);
    expect(a.fallen || b.fallen).toBe(false);
    expect(a.speed).toBeCloseTo(0, 9);
    expect(b.speed).toBeCloseTo(0, 9);
  });

  it('unequal speeds end with the same velocity along the normal (not elastic)', () => {
    const { world, a, b } = pair(3, 1); // closing 4
    step(world, []);
    // A drove east at 3, B west at 1: both end at 1 m/s to the east.
    expect(a.speed).toBeCloseTo(1, 9);
    expect(b.speed).toBeCloseTo(-1, 9); // B faces west and moves east
  });

  it('a closing speed exactly at the fall speed does not make them fall', () => {
    const { world, a, b } = pair(3, 3);
    const out = step(world, []);
    expect(a.fallen || b.fallen).toBe(false);
    expect(kinds(out.events)).toEqual(['collision:0:bike:1', 'collision:1:bike:0']);
  });

  it('passing side by side in opposite lanes (touching) gives no event and no speed loss', () => {
    const world = createWorld();
    const a = addBike(world, 0, { x: 0, y: 0, heading: 0 });
    a.speed = 10;
    const b = addBike(world, 1, { x: 0, y: 1.0, heading: Math.PI });
    b.speed = 10;
    const out = step(world, []);
    expect(out.events).toEqual([]);
    expect(a.speed).toBeCloseTo(10, 9);
    expect(b.speed).toBeCloseTo(10, 9);
    expect(b.y - a.y).toBeGreaterThanOrEqual(1.2); // pushed apart anyway
  });

  it('the push is shared equally', () => {
    const { world, a, b } = pair(0, 0, 1.0);
    step(world, []);
    expect(a.x + b.x).toBeCloseTo(1.0, 5); // the middle does not move
    expect(b.x - a.x).toBeGreaterThanOrEqual(1.2);
    expect(-a.x).toBeCloseTo(b.x - 1.0, 5);
  });

  it('the same place: the normal is +x, so the lower number goes east', () => {
    const world = createWorld();
    const a = addBike(world, 0, { x: 5, y: 5, heading: 0 });
    const b = addBike(world, 1, { x: 5, y: 5, heading: 0 });
    step(world, []);
    expect(a.x).toBeGreaterThan(b.x);
    expect(Number.isFinite(a.x + b.x + a.y + b.y)).toBe(true);
  });

  it('a fallen motorcycle is not solid for another one', () => {
    const { world, a, b } = pair(4, 4);
    a.fallen = true;
    const bx = b.x;
    const out = step(world, []);
    expect(out.events).toEqual([]);
    expect(b.x).toBe(bx);
  });

  it('a motorcycle that M1 drops (input.fall) gives no event and does not push the other', () => {
    const { world, b } = pair(4, 4);
    const bx = b.x;
    const out = step(world, [], { fall: [0] });
    expect(out.events).toEqual([]);
    expect(b.x).toBe(bx);
  });

  it('two substeps give one event for each player and other, with the larger speed', () => {
    const { world, a, b } = pair(1, 1);
    const stages: PhysicsStages = {
      ...STAGES,
      carsAndBikes: (ctx) => {
        if (ctx.substep === 1) {
          a.x = 0; a.speed = 2; b.x = 1.0; b.speed = 2;
        }
        COLLIDE_STAGES.carsAndBikes(ctx);
      },
    };
    const out = step(world, [], {}, stages);
    expect(kinds(out.events)).toEqual(['collision:0:bike:1', 'collision:1:bike:0']);
    for (const e of out.events) expect(e.impactSpeed).toBeCloseTo(4, 9);
  });

  it('three motorcycles: the result does not depend on the order in which they were added', () => {
    const spec = [
      { id: 0, x: 0, y: 0, heading: 0, speed: 5 },
      { id: 1, x: 1.0, y: 0.2, heading: Math.PI, speed: 3 },
      { id: 2, x: 0.5, y: 0.9, heading: -Math.PI / 2, speed: 4 },
    ];
    const run = (order: number[]) => {
      const world = createWorld();
      for (const i of order) {
        const s = spec[i];
        addBike(world, s.id, { x: s.x, y: s.y, heading: s.heading }).speed = s.speed;
      }
      const outs = [];
      for (let t = 0; t < 4; t++) outs.push(step(world, [], { tick: t }));
      return JSON.stringify(outs);
    };
    const base = run([0, 1, 2]);
    expect(base).toContain('"bike"');
    for (const order of [[2, 1, 0], [1, 2, 0], [2, 0, 1]]) expect(run(order)).toBe(base);
  });
});

describe('FakeM1 with the real city: a motorcycle hits an NPC car', () => {
  /** After 100 ticks one car that drives on a road gets a motorcycle in its way, 14 m ahead, driving at it. */
  function run() {
    const fake = new FakeM1({ seed: 5, players: [0], npcCars: 30, control: () => ({ throttle: 1 }) });
    const ticks = fake.run(100);
    const target = ticks[ticks.length - 1].cars.find((c) => c.state === 'driving' && c.edgeId !== null && c.speed > 3)!;
    const bike = fake.physics.bikes.get(0)!;
    bike.x = target.x + Math.cos(target.heading) * 14;
    bike.y = target.y + Math.sin(target.heading) * 14;
    bike.heading = target.heading + Math.PI;
    bike.speed = 9;
    bike.fallen = false;
    const after = fake.run(60);
    return { target, ticks: after };
  }

  it('the collision is found, the CarHit goes to the traffic part in the next tick and the car stops', () => {
    const { target, ticks } = run();
    const hitAt = ticks.findIndex((t) => t.physics.carHits.some((h) => h.carId === target.id));
    expect(hitAt).toBeGreaterThanOrEqual(0);
    const events = ticks[hitAt].physics.events;
    expect(events.some((e) => e.kind === 'collision' && e.with === 'npc' && e.other === target.id)).toBe(true);
    // The tick after the hit the traffic part has used the CarHit: the car is no longer driving.
    const next = ticks[hitAt + 1].cars.find((c) => c.id === target.id);
    expect(next === undefined || next.state !== 'driving').toBe(true);
    expect(ticks[hitAt].physics.carHits.find((h) => h.carId === target.id)!.impactSpeed).toBeGreaterThanOrEqual(CAR_HIT_MIN_MPS);
  });

  it('the same input gives the same result', () => {
    expect(JSON.stringify(run().ticks)).toBe(JSON.stringify(run().ticks));
  });
});
