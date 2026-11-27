import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../../../src/common/types.js';
import {
  addBike,
  COLLIDE_STAGES,
  createWorld,
  EMPTY_STAGES,
  stepPhysics,
  type PhysicsEvent,
  type PhysicsStages,
  type PhysicsWorld,
} from '../../../src/physics/index.js';
import {
  ACCIDENT_LANE_BLOCK_LENGTH_M,
  ACCIDENT_LANE_BLOCK_WIDTH_M,
  BARRIER_THICKNESS_M,
  BIKE_RADIUS_M,
  ROAD_BLOCK_WIDTH_M,
} from '../../../src/physics/collide/constants.js';
import { obstacleShapes } from '../../../src/physics/collide/obstacles.js';
import { m3City } from '../../fakes/cityPlan.js';

const STAGES: PhysicsStages = { ...EMPTY_STAGES, ...COLLIDE_STAGES };
const FALL = 6; // default physics.fall_speed_mps
const graph = m3City().graph;

// Road 0 of the fake plan graph: east-west at y = 0 from x = 0 to 100. Its forward edge (id 0) goes east
// from x = 7 to x = 93 (86 m), the right side of the direction is the south (y smaller), so lane 0 of the
// forward edge is at y = -1.75 and lane 1 at y = -5.25. The reverse edge (id 1) goes west from x = 93,
// its lane 0 is at y = +1.75. The middle of the road is (50, 0).
const ROAD = 0;
const FWD = 0;
const REV = 1;

const roadWork = (over: Partial<Obstacle> = {}): Obstacle => ({ id: 1, type: 'roadWork', roadId: ROAD, ...over });
const accident = (over: Partial<Obstacle> = {}): Obstacle => ({ id: 2, type: 'accident', roadId: ROAD, ...over });

function input(obstacles: readonly Obstacle[], over: object = {}) {
  return { tick: 0, dt: 1 / 30, bikes: [], obstacles, npcCars: [], quake: null, fall: [], standUp: [], ...over };
}

function worldWith(graphOn = true): PhysicsWorld {
  const world = createWorld();
  if (graphOn) world.graph = graph;
  return world;
}

/** A bike that overlaps the face by 0.3 m and drives into it. */
function bikeAt(world: PhysicsWorld, id: number, x: number, y: number, heading: number, speed: number) {
  const b = addBike(world, id, { x, y, heading });
  b.speed = speed;
  return b;
}

const kinds = (events: PhysicsEvent[]) =>
  events.map((e) => (e.kind === 'collision' ? `collision:${e.player}:${e.with}:${e.other}` : `fall:${e.player}:${e.cause}`));

const R = BIKE_RADIUS_M;

describe('obstacleShapes: where the shapes stand', () => {
  it('road work without s stands in the middle of the road, across both directions', () => {
    const [s] = obstacleShapes([roadWork()], graph);
    expect(s.hit).toBe('barrier');
    expect(s.box).toEqual({ x: 50, y: 0, length: BARRIER_THICKNESS_M, width: ROAD_BLOCK_WIDTH_M, heading: 0 });
  });

  it('s is the distance along the edge from its stop line', () => {
    const [s] = obstacleShapes([roadWork({ s: 10 })], graph);
    expect(s.box.x).toBeCloseTo(7 + 10, 9);
    expect(s.box.y).toBeCloseTo(0, 9);
  });

  it('the reverse edge counts s from its own start: the same place as the forward edge with L - s', () => {
    const a = obstacleShapes([roadWork({ edgeId: REV, s: 10 })], graph)[0].box;
    const b = obstacleShapes([roadWork({ edgeId: FWD, s: 86 - 10 })], graph)[0].box;
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.x).toBeCloseTo(93 - 10, 9);
  });

  it('road work with a lane is still across the whole road (the NPC traffic closes the whole road too)', () => {
    const [s] = obstacleShapes([roadWork({ lane: 1 })], graph);
    expect(s.box.width).toBe(ROAD_BLOCK_WIDTH_M);
    expect(s.box.y).toBeCloseTo(0, 9);
  });

  it('an accident with a lane is one lane wide and one car long, in the middle of that lane', () => {
    const fwd0 = obstacleShapes([accident({ lane: 0 })], graph)[0];
    expect(fwd0.hit).toBe('obstacle');
    expect(fwd0.box).toEqual({ x: 50, y: -1.75, length: ACCIDENT_LANE_BLOCK_LENGTH_M, width: ACCIDENT_LANE_BLOCK_WIDTH_M, heading: 0 });
    expect(obstacleShapes([accident({ lane: 1 })], graph)[0].box.y).toBeCloseTo(-5.25, 9);
    // The reverse edge: lane 0 is the lane next to the centre line on the other side; the heading is west.
    const rev0 = obstacleShapes([accident({ edgeId: REV, lane: 0, s: 10 })], graph)[0].box;
    expect(rev0.x).toBeCloseTo(83, 9);
    expect(rev0.y).toBeCloseTo(1.75, 9);
    expect(Math.abs(rev0.heading)).toBeCloseTo(Math.PI, 9);
    expect(obstacleShapes([accident({ edgeId: REV, lane: 1, s: 10 })], graph)[0].box.y).toBeCloseTo(5.25, 9);
  });

  it('an accident without a lane is the same barrier as road work, with the hit kind obstacle', () => {
    const [s] = obstacleShapes([accident()], graph);
    expect(s.hit).toBe('obstacle');
    expect(s.box).toEqual({ x: 50, y: 0, length: BARRIER_THICKNESS_M, width: ROAD_BLOCK_WIDTH_M, heading: 0 });
  });

  it('a vertical road (the heading is not 0) is turned the same way', () => {
    // Road 30: north-south at x = 0, forward edge goes south (y smaller), lane 0 is on its west side (x = -1.75).
    const [s] = obstacleShapes([accident({ roadId: 30, lane: 0 })], graph);
    expect(s.box.x).toBeCloseTo(-1.75, 9);
    expect(s.box.y).toBeCloseTo(-50, 9);
    expect(s.box.heading).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('heavy traffic and puddle are not solid: no shape', () => {
    const list: Obstacle[] = [
      { id: 3, type: 'heavyTraffic', roadId: ROAD },
      { id: 4, type: 'puddle', roadId: ROAD, edgeId: FWD, lane: 0, s: 20 },
    ];
    expect(obstacleShapes(list, graph)).toEqual([]);
  });

  it('no graph, or an obstacle that does not fit the graph, gives no shape and nothing is thrown', () => {
    expect(obstacleShapes([roadWork()], null)).toEqual([]);
    expect(obstacleShapes([roadWork({ roadId: 999 })], graph)).toEqual([]);
    expect(obstacleShapes([roadWork({ edgeId: 60 })], graph)).toEqual([]); // an edge of another road
    expect(obstacleShapes([accident({ lane: 2 })], graph)).toEqual([]); // the road has 2 lanes (0 and 1)
    expect(obstacleShapes([accident({ lane: 0, s: Number.NaN })], graph)).toEqual([]);
    expect(obstacleShapes([accident({ lane: 0, s: 90 })], graph)).toEqual([]); // beyond the 86 m
  });

  it('the shapes follow the order of the list', () => {
    const list = [accident({ id: 7, lane: 0 }), roadWork({ id: 5 })];
    expect(obstacleShapes(list, graph).map((s) => s.id)).toEqual([7, 5]);
  });
});

describe('a motorcycle against road work and accident', () => {
  // The west face of the road work barrier is at x = 50 - 0.5.
  const WEST_FACE = 50 - BARRIER_THICKNESS_M / 2;

  it('road work: a fast hit is a fall, cause barrier', () => {
    const world = worldWith();
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -1.75, 0, 8);
    const out = stepPhysics(world, input([roadWork()]), STAGES);
    expect(kinds(out.events)).toEqual(['collision:0:barrier:null', 'fall:0:barrier']);
    expect(out.events[0].impactSpeed).toBeCloseTo(8, 9);
    expect(bike.fallen).toBe(true);
  });

  it('road work: a slow hit is a bump, the motorcycle stops in front of it', () => {
    const world = worldWith();
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -1.75, 0, 4);
    const out = stepPhysics(world, input([roadWork()]), STAGES);
    expect(kinds(out.events)).toEqual(['collision:0:barrier:null']);
    expect(bike.fallen).toBe(false);
    expect(bike.speed).toBeCloseTo(0, 9);
    expect(bike.x).toBeLessThanOrEqual(WEST_FACE - R + 1e-9);
  });

  it('a hit exactly at the fall speed does not make it fall', () => {
    const world = worldWith();
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -1.75, 0, FALL);
    const out = stepPhysics(world, input([roadWork()]), STAGES);
    expect(bike.fallen).toBe(false);
    expect(kinds(out.events)).toEqual(['collision:0:barrier:null']);
  });

  it('follows the fall speed that the admin sets', () => {
    const world = worldWith();
    world.params.fallSpeed = 9;
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -1.75, 0, 8);
    stepPhysics(world, input([roadWork()]), STAGES);
    expect(bike.fallen).toBe(false);
  });

  it('road work is across the sidewalks too (20 m), and open beyond them', () => {
    for (const y of [-8.5, 8.5]) {
      const world = worldWith();
      const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, y, 0, 8);
      stepPhysics(world, input([roadWork()]), STAGES);
      expect(bike.fallen, `y ${y}`).toBe(true);
    }
    const world = worldWith();
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -11, 0, 8); // the building side, outside the 20 m
    const out = stepPhysics(world, input([roadWork()]), STAGES);
    expect(out.events).toEqual([]);
    expect(bike.fallen).toBe(false);
  });

  it('road work with a lane blocks the other lanes and the other direction too', () => {
    for (const y of [1.75, 5.25, -1.75, -5.25]) {
      const world = worldWith();
      const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, y, 0, 8);
      stepPhysics(world, input([roadWork({ lane: 0 })]), STAGES);
      expect(bike.fallen, `y ${y}`).toBe(true);
    }
  });

  it('accident in one lane: cause obstacle, a fast hit is a fall', () => {
    const world = worldWith();
    const west = 50 - ACCIDENT_LANE_BLOCK_LENGTH_M / 2;
    const bike = bikeAt(world, 0, west - R + 0.3, -1.75, 0, 8);
    const out = stepPhysics(world, input([accident({ lane: 0 })]), STAGES);
    expect(kinds(out.events)).toEqual(['collision:0:obstacle:null', 'fall:0:obstacle']);
    expect(bike.fallen).toBe(true);
  });

  it('accident in lane 0: a motorcycle in the next lane (lane 1) and in the other direction rides past', () => {
    for (const y of [-5.25, 1.75, 5.25]) {
      const world = worldWith();
      const bike = bikeAt(world, 0, 50, y, 0, 8);
      const out = stepPhysics(world, input([accident({ lane: 0 })]), STAGES);
      expect(out.events, `y ${y}`).toEqual([]);
      expect(bike.fallen).toBe(false);
      expect(bike.speed).toBeCloseTo(8, 9);
    }
  });

  it('accident in a lane of the reverse edge: lane 3 of the contracts is solid, the same lane of the forward edge is free', () => {
    const list = [accident({ edgeId: REV, lane: 0, s: 43 })]; // x = 93 - 43 = 50
    const hit = worldWith();
    // Driving west into the east face of the block (x = 50 + 2.25), overlapping it by 0.3 m.
    const b1 = bikeAt(hit, 0, 50 + ACCIDENT_LANE_BLOCK_LENGTH_M / 2 + R - 0.3, 1.75, Math.PI, 8);
    const o1 = stepPhysics(hit, input(list), STAGES);
    expect(kinds(o1.events)).toEqual(['collision:0:obstacle:null', 'fall:0:obstacle']);
    expect(b1.fallen).toBe(true);
    const free = worldWith();
    const b2 = bikeAt(free, 0, 50, -1.75, 0, 8);
    expect(stepPhysics(free, input(list), STAGES).events).toEqual([]);
    expect(b2.fallen).toBe(false);
  });

  it('accident without a lane blocks the whole road like road work', () => {
    for (const y of [-5.25, -1.75, 1.75, 5.25]) {
      const world = worldWith();
      const bike = bikeAt(world, 0, 50 - BARRIER_THICKNESS_M / 2 - R + 0.3, y, 0, 8);
      const out = stepPhysics(world, input([accident()]), STAGES);
      expect(kinds(out.events), `y ${y}`).toEqual(['collision:0:obstacle:null', 'fall:0:obstacle']);
      expect(bike.fallen).toBe(true);
    }
  });

  it('a hit from the side of the lane block (a motorcycle that crosses the lane) counts along the normal', () => {
    const world = worldWith();
    // From the north side (the centre line side) into the block of lane 0 (y from -3.5 to 0), driving south.
    const bike = bikeAt(world, 0, 50, 0 + R - 0.3, -Math.PI / 2, 8);
    const out = stepPhysics(world, input([accident({ lane: 0 })]), STAGES);
    expect(kinds(out.events)).toEqual(['collision:0:obstacle:null', 'fall:0:obstacle']);
    expect(out.events[0].impactSpeed).toBeCloseTo(8, 9);
    expect(bike.fallen).toBe(true);
  });

  it('heavy traffic and puddle are not solid: a motorcycle rides through', () => {
    const list: Obstacle[] = [
      { id: 3, type: 'heavyTraffic', roadId: ROAD },
      { id: 4, type: 'puddle', roadId: ROAD, edgeId: FWD, lane: 0, s: 43 },
    ];
    const world = worldWith();
    const bike = bikeAt(world, 0, 50, -1.75, 0, 8);
    expect(stepPhysics(world, input(list), STAGES).events).toEqual([]);
    expect(bike.speed).toBe(8);
  });

  it('without a graph the obstacles are not solid and nothing is thrown', () => {
    const world = worldWith(false);
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -1.75, 0, 8);
    expect(() => stepPhysics(world, input([roadWork(), accident({ lane: 0 })]), STAGES)).not.toThrow();
    expect(bike.fallen).toBe(false);
    expect(bike.speed).toBe(8);
  });

  it('the shape is gone when M1 takes the obstacle out of the list', () => {
    const world = worldWith();
    const bike = bikeAt(world, 0, WEST_FACE - R + 0.3, -1.75, 0, 4);
    const withIt = stepPhysics(world, input([roadWork()]), STAGES);
    expect(withIt.events.length).toBe(1);
    // The same overlap again, now without the obstacle in the list: no push, no event.
    bike.x = WEST_FACE - R + 0.3;
    bike.speed = 4;
    const without = stepPhysics(world, input([], { tick: 1 }), STAGES);
    expect(without.events).toEqual([]);
    expect(bike.speed).toBe(4);
    expect(bike.x).toBeCloseTo(WEST_FACE - R + 0.3, 12);
  });

  it('two obstacles in one tick: each motorcycle hits its own, the events say which kind', () => {
    const world = worldWith();
    bikeAt(world, 0, 50 - BARRIER_THICKNESS_M / 2 - R + 0.3, -1.75, 0, 8); // road work at 50
    bikeAt(world, 1, 20 - ACCIDENT_LANE_BLOCK_LENGTH_M / 2 - R + 0.3, -1.75, 0, 3); // accident in lane 0 at x = 20
    const list = [roadWork({ id: 1 }), accident({ id: 2, lane: 0, s: 13 })]; // 7 + 13 = 20
    const out = stepPhysics(world, input(list), STAGES);
    expect(kinds(out.events)).toEqual(['collision:0:barrier:null', 'fall:0:barrier', 'collision:1:obstacle:null']);
  });

  it('the same input gives the same result (JSON)', () => {
    const run = () => {
      const world = worldWith();
      bikeAt(world, 0, 49, -1.75, 0, 7);
      bikeAt(world, 1, 45, -5.25, 0, 3);
      const outs = [];
      for (let t = 0; t < 10; t++) outs.push(stepPhysics(world, input([roadWork(), accident({ id: 2, lane: 1, s: 30 })], { tick: t }), STAGES));
      return JSON.stringify(outs);
    };
    expect(run()).toBe(run());
  });
});

describe('tunnel guard for the obstacles', () => {
  const H = 1 / 60;
  const TOP = 30 * 1.5;

  it('one substep at the highest speed is shorter than the radius plus half of every dimension that a motorcycle can meet', () => {
    const move = TOP * H;
    expect(move, 'road work thickness').toBeLessThan(R + BARRIER_THICKNESS_M / 2);
    expect(move, 'accident length (driving along the lane)').toBeLessThan(R + ACCIDENT_LANE_BLOCK_LENGTH_M / 2);
    expect(move, 'accident width (crossing the lane)').toBeLessThan(R + ACCIDENT_LANE_BLOCK_WIDTH_M / 2);
  });

  /** Drives at a speed along a lane towards the block (x grows), many starting phases; returns how many ended beyond the middle. */
  function through(obstacle: Obstacle, y: number, speed: number, heading = 0): number {
    let wrong = 0;
    for (let k = 0; k < 60; k++) {
      const world = worldWith();
      const bike = bikeAt(world, 0, 20 + (k / 60) * speed * H, y, heading, speed);
      const stages: PhysicsStages = {
        ...EMPTY_STAGES,
        speedAndSteering: (ctx) => {
          for (const b of ctx.world.bikes.values()) {
            if (b.fallen) continue;
            b.x += b.speed * Math.cos(b.heading) * ctx.h;
            b.y += b.speed * Math.sin(b.heading) * ctx.h;
          }
        },
        ...COLLIDE_STAGES,
      };
      let met = false;
      for (let t = 0; t < 40 && !met; t++) met = stepPhysics(world, input([obstacle], { tick: t }), stages).events.length > 0;
      if (!met || bike.x > 50) wrong++;
    }
    return wrong;
  }

  it('a motorcycle at 45 m/s never gets through road work or an accident (all starting phases)', () => {
    expect(through(roadWork(), -1.75, TOP)).toBe(0);
    expect(through(accident({ lane: 0 }), -1.75, TOP)).toBe(0);
    expect(through(accident(), -5.25, TOP)).toBe(0);
  });
});
