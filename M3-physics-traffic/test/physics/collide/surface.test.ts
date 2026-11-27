import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../../../src/common/types.js';
import {
  addBike,
  BIKE_STAGES,
  createWorld,
  DEFAULT_PHYSICS_PARAMS,
  EMPTY_STAGES,
  Predictor,
  stepPhysics,
  type BikeControl,
  type PhysicsInput,
  type PhysicsWorld,
  type QuakeArea,
  type SurfaceProvider,
} from '../../../src/physics/index.js';
import type { SurfaceScene } from '../../../src/physics/world.js';
import { colliderSurface, obstacleShapes, obstacleSites } from '../../../src/physics/collide/index.js';
import {
  ACCIDENT_SLOW_RADIUS_M,
  ACCIDENT_SLOW_SPEED_MPS,
  PUDDLE_LENGTH_M,
  PUDDLE_ROAD_WIDTH_M,
} from '../../../src/physics/collide/constants.js';
import { m3City } from '../../fakes/cityPlan.js';

const graph = m3City().graph;
const P = DEFAULT_PHYSICS_PARAMS; // grip 1, gripPuddle 0.4, gripQuake 0.5
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };

// Road 0 of the fake plan graph: east-west at y = 0, forward edge 0 goes east (x 7 to 93), its lane 0 is at
// y = -1.75 and lane 1 at y = -5.25; the reverse edge (1) has its lane 0 at y = +1.75. The middle is (50, 0).
const accident = (over: Partial<Obstacle> = {}): Obstacle => ({ id: 2, type: 'accident', roadId: 0, ...over });
const puddle = (over: Partial<Obstacle> = {}): Obstacle => ({ id: 3, type: 'puddle', roadId: 0, ...over });
const roadWork = (over: Partial<Obstacle> = {}): Obstacle => ({ id: 1, type: 'roadWork', roadId: 0, ...over });
const QUAKE: QuakeArea = { x: 200, y: -200, radius: 30, strength: 5 };

function worldWith(graphOn = true): PhysicsWorld {
  const world = createWorld();
  if (graphOn) world.graph = graph;
  world.surfaceAt = colliderSurface(world);
  return world;
}

const scene = (obstacles: Obstacle[] = [], quake: QuakeArea | null = null): SurfaceScene => ({ obstacles, quake });
const at = (world: PhysicsWorld, x: number, y: number, s?: SurfaceScene) => world.surfaceAt(x, y, world.params, s);

describe('obstacleSites and obstacleShapes after the split', () => {
  it('the sites have the centre of the lane (or of the road) and the heading of the edge', () => {
    const [lane, whole] = obstacleSites([accident({ lane: 0 }), puddle({ id: 4 })], graph);
    expect(lane).toMatchObject({ id: 2, type: 'accident', wholeRoad: false, x: 50, y: -1.75, heading: 0 });
    expect(whole).toMatchObject({ id: 4, type: 'puddle', wholeRoad: true, x: 50, heading: 0 });
    expect(whole.y).toBeCloseTo(0, 9);
  });

  it('heavy traffic has no site, an obstacle that does not fit the graph has none, no graph none', () => {
    expect(obstacleSites([{ id: 9, type: 'heavyTraffic', roadId: 0 }], graph)).toEqual([]);
    expect(obstacleSites([puddle({ lane: 5 })], graph)).toEqual([]);
    expect(obstacleSites([puddle()], null)).toEqual([]);
  });

  it('the solid shape and the site of an accident have the same centre; a puddle has no solid shape', () => {
    const list = [accident({ lane: 1, s: 20 }), puddle({ lane: 0 })];
    const shapes = obstacleShapes(list, graph);
    const sites = obstacleSites(list, graph);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].box.x).toBe(sites[0].x);
    expect(shapes[0].box.y).toBe(sites[0].y);
  });
});

describe('colliderSurface: zones', () => {
  it('a puddle in lane 0: inside, on the border (included) and outside', () => {
    const w = worldWith();
    const s = scene([puddle({ lane: 0 })]); // x 46 to 54, y -3.5 to 0
    expect(at(w, 50, -1.75, s).grip).toBe(P.gripPuddle);
    expect(at(w, 50 + PUDDLE_LENGTH_M / 2, -1.75, s).grip).toBe(P.gripPuddle); // border: inside
    expect(at(w, 50 + PUDDLE_LENGTH_M / 2 + 0.01, -1.75, s).grip).toBe(P.grip);
    expect(at(w, 50, -3.5, s).grip).toBe(P.gripPuddle);
    expect(at(w, 50, -3.51, s).grip).toBe(P.grip);
    expect(at(w, 50, 0, s).grip).toBe(P.gripPuddle);
    expect(at(w, 50, 0.01, s).grip).toBe(P.grip);
  });

  it('a puddle with a lane stays in its lane: not the next lane, not the other direction', () => {
    const w = worldWith();
    const s = scene([puddle({ lane: 0 })]);
    expect(at(w, 50, -5.25, s).grip).toBe(P.grip);
    expect(at(w, 50, 1.75, s).grip).toBe(P.grip);
    expect(at(w, 50, 5.25, s).grip).toBe(P.grip);
    // The second lane, and the lane of the reverse edge.
    expect(at(w, 50, -5.25, scene([puddle({ lane: 1 })])).grip).toBe(P.gripPuddle);
    expect(at(w, 50, 1.75, scene([puddle({ edgeId: 1, lane: 0, s: 43 })])).grip).toBe(P.gripPuddle);
  });

  it('a puddle without a lane is the road (14 m across), the sidewalk is dry', () => {
    const w = worldWith();
    const s = scene([puddle()]);
    for (const y of [-6.9, -1.75, 0, 1.75, 6.9]) expect(at(w, 50, y, s).grip, `y ${y}`).toBe(P.gripPuddle);
    expect(at(w, 50, PUDDLE_ROAD_WIDTH_M / 2, s).grip).toBe(P.gripPuddle); // border
    for (const y of [7.1, 8.5, -7.1]) expect(at(w, 50, y, s).grip, `y ${y}`).toBe(P.grip);
    expect(at(w, 54.01, 0, s).grip).toBe(P.grip);
  });

  it('a puddle on a vertical road is turned (the length is along the road)', () => {
    const w = worldWith();
    const s = scene([puddle({ roadId: 30, lane: 0 })]); // centre (-1.75, -50), the road goes south
    expect(at(w, -1.75, -50 - 3.9, s).grip).toBe(P.gripPuddle);
    expect(at(w, -1.75, -50 - 4.1, s).grip).toBe(P.grip);
    expect(at(w, -1.75 + 1.7, -50, s).grip).toBe(P.gripPuddle);
    expect(at(w, -1.75 + 1.9, -50, s).grip).toBe(P.grip);
  });

  it('the slow zone of an accident: a circle of 15 m, the border is inside, for all lanes and both directions', () => {
    const w = worldWith();
    const s = scene([accident({ lane: 0 })]); // centre (50, -1.75)
    for (const y of [-5.25, -1.75, 1.75, 5.25]) expect(at(w, 50, y, s).speedCap, `y ${y}`).toBe(ACCIDENT_SLOW_SPEED_MPS);
    expect(at(w, 50 + ACCIDENT_SLOW_RADIUS_M, -1.75, s).speedCap).toBe(ACCIDENT_SLOW_SPEED_MPS); // border
    expect(at(w, 50 + ACCIDENT_SLOW_RADIUS_M + 0.01, -1.75, s).speedCap).toBeNull();
    expect(at(w, 50 - ACCIDENT_SLOW_RADIUS_M - 0.01, -1.75, s).speedCap).toBeNull();
    expect(at(w, 50, -1.75 - ACCIDENT_SLOW_RADIUS_M - 0.01, s).speedCap).toBeNull();
    // The grip of an accident is the grip of the road.
    expect(at(w, 50, -1.75, s).grip).toBe(P.grip);
  });

  it('an accident without a lane has its centre on the centre line', () => {
    const w = worldWith();
    const s = scene([accident()]); // centre (50, 0)
    expect(at(w, 50, 14.9, s).speedCap).toBe(ACCIDENT_SLOW_SPEED_MPS);
    expect(at(w, 50, 15.1, s).speedCap).toBeNull();
  });

  it('road work and heavy traffic give no ground effect', () => {
    const w = worldWith();
    const s = scene([roadWork(), { id: 5, type: 'heavyTraffic', roadId: 0 }]);
    expect(at(w, 50, -1.75, s)).toEqual({ grip: P.grip, speedCap: null });
  });

  it('the earthquake: inside the circle the grip is quake.grip, the border is inside, strength does not matter', () => {
    const w = worldWith();
    for (const strength of [1, 5, 10]) {
      const s = scene([], { ...QUAKE, strength });
      expect(at(w, 200, -200, s).grip).toBe(P.gripQuake);
      expect(at(w, 230, -200, s).grip).toBe(P.gripQuake); // border
      expect(at(w, 230.01, -200, s).grip).toBe(P.grip);
    }
  });

  it('no earthquake (null) or an earthquake that is over: the normal grip', () => {
    const w = worldWith();
    expect(at(w, 200, -200, scene([], null)).grip).toBe(P.grip);
    expect(at(w, 200, -200, scene([], QUAKE)).grip).toBe(P.gripQuake);
    expect(at(w, 200, -200, scene([], null)).grip).toBe(P.grip); // and again without it
  });

  it('the earthquake does not need the graph', () => {
    const w = worldWith(false);
    expect(at(w, 200, -200, scene([], QUAKE)).grip).toBe(P.gripQuake);
  });
});

describe('colliderSurface: several zones, other providers, no scene', () => {
  it('puddle and earthquake together: the lowest grip wins, in both orders of the numbers', () => {
    const w = worldWith();
    const s = scene([puddle({ lane: 0 })], { x: 50, y: -1.75, radius: 30, strength: 5 });
    w.params.gripPuddle = 0.3;
    w.params.gripQuake = 0.5;
    expect(at(w, 50, -1.75, s).grip).toBe(0.3);
    w.params.gripPuddle = 0.45;
    w.params.gripQuake = 0.2;
    expect(at(w, 50, -1.75, s).grip).toBe(0.2);
  });

  it('a puddle never gives more grip than the road itself', () => {
    const w = worldWith();
    w.params.grip = 0.3; // the admin made the road slippery; the puddle (0.4) must not make it better
    expect(at(w, 50, -1.75, scene([puddle({ lane: 0 })])).grip).toBe(0.3);
  });

  it('two accidents: the speed limit is the lowest, and the base limit counts too', () => {
    const w = worldWith();
    const s = scene([accident({ lane: 0 }), accident({ id: 6, roadId: 5 })]);
    expect(at(w, 50, -1.75, s).speedCap).toBe(ACCIDENT_SLOW_SPEED_MPS);
    const base: SurfaceProvider = (_x, _y, p) => ({ grip: p.grip, speedCap: 3 });
    const w2 = worldWith();
    w2.surfaceAt = colliderSurface(w2, base);
    expect(at(w2, 50, -1.75, s).speedCap).toBe(3); // 3 is lower than 5
    expect(at(w2, 500, -1.75, s).speedCap).toBe(3); // outside the zone the base stays
    const base7: SurfaceProvider = (_x, _y, p) => ({ grip: p.grip * 0.8, speedCap: 7 });
    w2.surfaceAt = colliderSurface(w2, base7);
    expect(at(w2, 50, -1.75, scene([accident({ lane: 0 }), puddle({ id: 8, lane: 0 })]))).toEqual({ grip: P.gripPuddle, speedCap: 5 });
    expect(at(w2, 500, -1.75, scene([accident({ lane: 0 })]))).toEqual({ grip: P.grip * 0.8, speedCap: 7 });
  });

  it('a base provider on top: its ground is lowered, not replaced (like the test ground of the demo)', () => {
    const w = worldWith();
    const testGround: SurfaceProvider = (x, _y, p) => ({ grip: x > 100 ? p.grip * 0.9 : p.grip, speedCap: null });
    w.surfaceAt = colliderSurface(w, testGround);
    expect(at(w, 150, -1.75, scene([])).grip).toBeCloseTo(0.9, 12);
    expect(at(w, 50, -1.75, scene([puddle({ lane: 0 })])).grip).toBe(P.gripPuddle);
    // Road 1 goes from x = 100 to 200: a puddle at 107 + 43 = 150, where the base grip is 0.9: the lower grip wins.
    expect(at(w, 150, -1.75, scene([puddle({ roadId: 1, lane: 0, s: 43 })])).grip).toBe(P.gripPuddle);
  });

  it('without a scene (the old three argument call) only the base counts', () => {
    const w = worldWith();
    expect(at(w, 50, -1.75)).toEqual({ grip: P.grip, speedCap: null });
    expect(w.surfaceAt(50, -1.75, w.params)).toEqual({ grip: P.grip, speedCap: null });
  });

  it('an old provider with three arguments still works in the stages', () => {
    const world = createWorld();
    world.surfaceAt = (_x, _y, p) => ({ grip: p.grip, speedCap: 6 });
    const bike = addBike(world, 0, { x: 0, y: 0, heading: 0 });
    bike.speed = 10;
    stepPhysics(world, input([]), STAGES);
    expect(bike.speed).toBeLessThan(10);
  });

  it('the obstacles that M1 took out of the list leave no ground effect', () => {
    const w = worldWith();
    expect(at(w, 50, -1.75, scene([puddle({ lane: 0 }), accident({ lane: 0 })])).grip).toBe(P.gripPuddle);
    expect(at(w, 50, -1.75, scene([]))).toEqual({ grip: P.grip, speedCap: null });
  });

  it('without a graph the obstacles have no effect and nothing is thrown', () => {
    const w = worldWith(false);
    expect(() => at(w, 50, -1.75, scene([puddle({ lane: 0 }), accident({ lane: 0 })]))).not.toThrow();
    expect(at(w, 50, -1.75, scene([puddle({ lane: 0 }), accident({ lane: 0 })]))).toEqual({ grip: P.grip, speedCap: null });
  });
});

function input(obstacles: Obstacle[], quake: QuakeArea | null = null, over: Partial<PhysicsInput> = {}): PhysicsInput {
  return { tick: 0, dt: 1 / 30, bikes: [], obstacles, npcCars: [], quake, fall: [], standUp: [], ...over };
}

/** Holds the speed and steers to the right for some ticks; gives the largest side speed. */
function slideWith(world: PhysicsWorld, obstacles: Obstacle[], quake: QuakeArea | null, x0: number, y: number, ticks = 10): number {
  const bike = addBike(world, 0, { x: x0, y, heading: 0 });
  let max = 0;
  for (let t = 0; t < ticks; t++) {
    bike.speed = 10; // the speed is held by hand, only the grip changes
    stepPhysics(
      world,
      input(obstacles, quake, { tick: t, bikes: [{ player: 0, speedFactor: 1, control: { throttle: 1, brake: 0, steer: 1, seq: t } }] }),
      STAGES,
    );
    max = Math.max(max, Math.abs(bike.slip));
  }
  return max;
}

describe('colliderSurface: driving', () => {
  it('the same steering slides more in a puddle than on the road (the grip is the stage input)', () => {
    const dry = slideWith(worldWith(), [], null, 47, -1.75);
    const wet = slideWith(worldWith(), [puddle({ lane: 0 })], null, 47, -1.75);
    expect(dry).toBe(0);
    expect(wet).toBeGreaterThan(0.5);
  });

  it('the same steering slides more in the earthquake area', () => {
    const dry = slideWith(worldWith(), [], null, 200, -200);
    const shaken = slideWith(worldWith(), [], QUAKE, 200, -200);
    expect(dry).toBe(0);
    expect(shaken).toBeGreaterThan(0.5);
    // quake.grip 0.5 slides less than physics.grip_puddle 0.4
    const wet = slideWith(worldWith(), [], { ...QUAKE, radius: 100 }, 200, -200);
    expect(wet).toBeCloseTo(shaken, 9);
  });

  it('the earthquake ends: the next tick without it has the normal grip again', () => {
    const world = worldWith();
    const bike = addBike(world, 0, { x: 200, y: -200, heading: 0 });
    const run = (quake: QuakeArea | null, t: number) => {
      bike.speed = 10;
      bike.slip = 0;
      stepPhysics(world, input([], quake, { tick: t, bikes: [{ player: 0, speedFactor: 1, control: { throttle: 1, brake: 0, steer: 1, seq: t } }] }), STAGES);
      return Math.abs(bike.slip);
    };
    expect(run(QUAKE, 0)).toBeGreaterThan(0);
    expect(run(null, 1)).toBe(0);
  });

  /** A motorcycle that is in the slow zone brakes down to the limit, and keeps it. */
  function drive(world: PhysicsWorld, obstacles: Obstacle[], x: number, y: number, heading: number, speed: number, ticks: number) {
    const bike = addBike(world, 0, { x, y, heading });
    bike.speed = speed;
    for (let t = 0; t < ticks; t++) {
      stepPhysics(world, input(obstacles, null, { tick: t, bikes: [{ player: 0, speedFactor: 1, control: { throttle: 1, brake: 0, steer: 0, seq: t } }] }), STAGES);
      bike.x = x; // stay in the zone: only the speed is looked at
      bike.y = y;
    }
    return bike;
  }

  it('the slow zone of an accident brakes to 5 m/s in every lane and in both directions, and not outside', () => {
    for (const [y, heading] of [[-5.25, 0], [-1.75, 0], [1.75, Math.PI], [5.25, Math.PI]] as const) {
      const bike = drive(worldWith(), [accident({ lane: 0 })], 50, y, heading, 14, 60);
      expect(bike.speed, `y ${y}`).toBeCloseTo(ACCIDENT_SLOW_SPEED_MPS, 6);
    }
    const free = drive(worldWith(), [accident({ lane: 0 })], 80, -1.75, 0, 14, 60); // 30 m away
    expect(free.speed).toBeGreaterThan(ACCIDENT_SLOW_SPEED_MPS + 5);
  });

  it('the speed limit is only for the forward speed: a motorcycle that reverses is not held at the limit', () => {
    const world = worldWith();
    world.surfaceAt = colliderSurface(world, (_x, _y, p) => ({ grip: p.grip, speedCap: 1 })); // a limit below the reverse maximum
    const bike = addBike(world, 0, { x: 50, y: -1.75, heading: 0 });
    bike.speed = -2;
    stepPhysics(world, input([], null, { bikes: [{ player: 0, speedFactor: 1, control: { throttle: 0, brake: 1, steer: 0, seq: 0 } }] }), STAGES);
    expect(bike.speed).toBeLessThan(-2); // still going backwards, faster
  });

  it('the same input gives the same result (JSON)', () => {
    const run = () => {
      const world = worldWith();
      const bike = addBike(world, 0, { x: 40, y: -1.75, heading: 0 });
      bike.speed = 12;
      const outs = [];
      for (let t = 0; t < 40; t++) {
        outs.push(
          stepPhysics(world, input([puddle({ lane: 0 }), accident({ lane: 0 })], QUAKE, { tick: t, bikes: [{ player: 0, speedFactor: 1, control: { throttle: 1, brake: 0, steer: 0.6, seq: t } }] }), STAGES),
        );
      }
      return JSON.stringify(outs);
    };
    expect(run()).toBe(run());
  });
});

describe('the predictor and the server give the same ground', () => {
  it('with the same scene, a ride through a puddle, an accident zone and the earthquake gives the same result', () => {
    const START = { x: 30, y: -1.75, heading: 0 };
    const obstacles = [puddle({ lane: 0 }), accident({ lane: 0, s: 60 })];
    const quake: QuakeArea = { x: 40, y: -1.75, radius: 6, strength: 7 };
    const server = worldWith();
    addBike(server, 0, START);
    const predictor = new Predictor(0, START, {
      setupWorld: (w) => {
        w.graph = graph;
        w.surfaceAt = colliderSurface(w);
      },
    });
    predictor.setScene({ obstacles, quake });
    let slid = 0;
    for (let t = 0; t < 120; t++) {
      const c: BikeControl = { throttle: 1, brake: 0, steer: Math.sin(t / 8) * 0.9, seq: t };
      stepPhysics(server, input(obstacles, quake, { tick: t, bikes: [{ player: 0, speedFactor: 1, control: c }] }), STAGES);
      predictor.step(c);
      const s = server.bikes.get(0)!;
      expect(predictor.bike.x).toBe(s.x);
      expect(predictor.bike.y).toBe(s.y);
      expect(predictor.bike.speed).toBe(s.speed);
      expect(predictor.bike.slip).toBe(s.slip);
      slid = Math.max(slid, Math.abs(s.slip));
    }
    expect(slid).toBeGreaterThan(0.3); // the ride really slid
  });
});
