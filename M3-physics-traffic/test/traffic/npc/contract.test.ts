import { describe, expect, it } from 'vitest';
import {
  fromContractObstacle,
  fromContractObstacles,
  fromContractPlayer,
  fromContractPlayers,
  heavyTrafficFromEffect,
  NpcTraffic,
  toContractCar,
  trafficParamChanges,
  type ContractObstacle,
  type NpcCarPose,
} from '../../../src/traffic/npc/index.js';
import type { RoadGraph } from '../../../src/traffic/graph/types.js';
import { makeGridGraph } from '../../fakes/fakeRoadGraph.js';
import { DT, minSameLaneGap, run } from './helpers.js';

/**
 * A grid shaped like contracts/city_plan.json: 100 m pitch, 2 lanes each way,
 * row r at z = 100 r, so in M3 coordinates at y = -100 r.
 */
function contractLikeGraph(): RoadGraph {
  const g = makeGridGraph({ spacing: 100, lanesPerDirection: 2 });
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, y: -n.y })) };
}

const g = contractLikeGraph();
const ob = (o: Partial<ContractObstacle>): ContractObstacle => ({ id: 1, type: 'accident', segment: 0, lane: 1, pos: 0.25, ...o });

describe('road numbers', () => {
  it('follow the formulas of contracts/README.md', () => {
    // h_r_c = 5r + c from n_r_c to n_r_(c+1); v_r_c = 30 + 6r + c from n_r_c to n_(r+1)_c; n_r_c = 6r + c.
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 5; c++) expect(g.roads[5 * r + c]).toMatchObject({ a: 6 * r + c, b: 6 * r + c + 1 });
    }
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 6; c++) expect(g.roads[30 + 6 * r + c]).toMatchObject({ a: 6 * r + c, b: 6 * (r + 1) + c });
    }
  });
});

describe('fromContractObstacle', () => {
  const forward = 0; // h_0_0, from n_0_0 to n_0_1 (east)
  const reverse = 1;
  // Segment is 100 m between node centres; the intersection box is 7 m on each side.

  it('turns contracts lanes 1-4 into edge and lane from the centre line', () => {
    expect(fromContractObstacle(ob({ lane: 1 }), g)).toEqual({ id: 1, type: 'accident', roadId: 0, edgeId: forward, lane: 0, s: 18 });
    expect(fromContractObstacle(ob({ lane: 2 }), g)).toMatchObject({ edgeId: forward, lane: 1, s: 18 });
    expect(fromContractObstacle(ob({ lane: 3 }), g)).toMatchObject({ edgeId: reverse, lane: 0, s: 68 });
    expect(fromContractObstacle(ob({ lane: 4 }), g)).toMatchObject({ edgeId: reverse, lane: 1, s: 68 });
  });

  it('keeps lane 0 as the whole road and uses the snake_case type names of M1', () => {
    const o = fromContractObstacle(ob({ type: 'road_work', segment: 31, lane: 0, pos: 0.5 }), g);
    expect(o).toEqual({ id: 1, type: 'roadWork', roadId: 31, edgeId: 62, s: 43 });
    expect(fromContractObstacles([ob({ type: 'heavy_traffic' }), ob({ type: 'puddle' })], g).map((x) => x.type)).toEqual([
      'heavyTraffic',
      'puddle',
    ]);
  });

  it('throws on values that do not fit the city', () => {
    expect(() => fromContractObstacle(ob({ type: 'fire' as never }), g)).toThrow(RangeError);
    expect(() => fromContractObstacle(ob({ segment: 60 }), g)).toThrow(RangeError);
    expect(() => fromContractObstacle(ob({ lane: 5 }), g)).toThrow(RangeError);
    expect(() => fromContractObstacle(ob({ pos: 1.5 }), g)).toThrow(RangeError);
  });
});

describe('toContractCar', () => {
  const car = (edgeId: number | null, lane: number, heading: number): NpcCarPose => ({
    id: 3, x: 50, y: -5.25, heading, speed: 10, edgeId, lane, length: 4.5, width: 1.8, state: 'driving',
  });

  it('gives contracts coordinates, segment and lane', () => {
    expect(toContractCar(car(0, 1, 0), g)).toEqual({
      id: 3, x: 50, z: 5.25, heading: 90, speed: 10, segment: 0, lane: 2, length: 4.5, width: 1.8, state: 'driving',
    });
    const back = toContractCar(car(1, 0, Math.PI), g);
    expect(back).toMatchObject({ segment: 0, lane: 3, heading: 270 });
    expect(toContractCar(car(null, 0, 0), g)).toMatchObject({ segment: null, lane: null });
  });

  it('puts every car of a running city on a valid contracts lane', () => {
    const t = new NpcTraffic(g, { seed: 1, params: { carCount: 40 } });
    const out = run(t, 300);
    for (const c of out.cars.map((x) => toContractCar(x, g))) {
      if (c.segment === null) continue;
      expect(c.lane).toBeGreaterThanOrEqual(1);
      expect(c.lane).toBeLessThanOrEqual(4);
    }
  });
});

describe('fromContractPlayer', () => {
  const pl = (heading: number, x = 100, z = 50) => ({ id: 1, x, z, heading, speed: 8, fallen: false });

  it('turns contracts x, z and degrees into M3 x, y and radians', () => {
    expect(fromContractPlayer(pl(90))).toEqual({ id: 1, x: 100, y: -50, heading: 0, speed: 8, fallen: false });
    expect(fromContractPlayer(pl(0)).heading).toBeCloseTo(Math.PI / 2); // north
    expect(fromContractPlayer(pl(180)).heading).toBeCloseTo(-Math.PI / 2); // south
    expect(Math.abs(fromContractPlayer(pl(270)).heading)).toBeCloseTo(Math.PI); // west
  });

  it('throws on a pose that is not a number', () => {
    expect(() => fromContractPlayer(pl(NaN))).toThrow(RangeError);
    expect(() => fromContractPlayer({ ...pl(0), x: Infinity })).toThrow(RangeError);
  });

  it('cars keep their gap behind a motorcycle that M1 gives in contracts coordinates', () => {
    // Standing in lane 1 of h_1_1 (east-bound, next to the centre line): 1.75 m south of the centre line.
    const m1Players = [{ id: 0, x: 150, z: 101.75, heading: 90, speed: 0, fallen: false }];
    const players = fromContractPlayers(m1Players);
    const t = new NpcTraffic(g, { seed: 4, params: { carCount: 60, minSpawnDistance: 20 } });
    let closest = Infinity;
    run(
      t,
      60 * 30,
      () => ({ players }),
      (o) => {
        for (const c of o.cars) {
          if (c.state === 'offroad') continue;
          closest = Math.min(closest, Math.hypot(c.x - players[0].x, c.y - players[0].y));
        }
      },
    );
    expect(closest).toBeGreaterThan(3.3); // car half length 2.25 + motorcycle half length 1.1
  });
});

describe('NpcTraffic input checks', () => {
  it('throws on obstacles that do not fit the road graph', () => {
    const t = new NpcTraffic(g, { seed: 1 });
    const step = (o: object) => () =>
      t.step({ dt: DT, players: [], obstacles: [{ id: 1, type: 'accident', roadId: 0, ...o }], carHits: [] });
    expect(step({ roadId: 99 })).toThrow(RangeError);
    expect(step({ edgeId: 5 })).toThrow(RangeError);
    expect(step({ lane: 2 })).toThrow(RangeError);
    expect(step({ s: -1 })).toThrow(RangeError);
    expect(step({ lane: 1, s: 10 })).not.toThrow();
  });

  it('throws on a bad dt and cuts a very long one', () => {
    const t = new NpcTraffic(g, { seed: 1, params: { carCount: 60 } });
    for (const dt of [NaN, 0, -1, Infinity]) {
      expect(() => t.step({ dt, players: [], obstacles: [], carHits: [] })).toThrow(RangeError);
    }
    let minGap = Infinity;
    for (let i = 0; i < 200; i++) {
      const out = t.step({ dt: 5, players: [], obstacles: [], carHits: [] });
      minGap = Math.min(minGap, minSameLaneGap(out.cars));
    }
    expect(minGap).toBeGreaterThanOrEqual(0);
  });

  it('throws on a bad parameter and keeps the old values', () => {
    const t = new NpcTraffic(g, { seed: 1, params: { carCount: 10 } });
    expect(() => new NpcTraffic(g, { seed: 1, params: { maxSpeed: 0 } })).toThrow(RangeError);
    expect(() => run(t, 1, () => ({ params: { carCount: -1 } }))).toThrow(RangeError);
    expect(() => run(t, 1, () => ({ params: { heavyTrafficSpeedFactor: 2 } }))).toThrow(RangeError);
    expect(t.currentParams.carCount).toBe(10);
  });
});

describe('reset', () => {
  it('starts a new game exactly like a new instance with the same seed', () => {
    const heavy = [{ id: 1, type: 'heavyTraffic' as const, roadId: 3 }];
    const t = new NpcTraffic(g, { seed: 5, params: { carCount: 30 } });
    run(t, 600, () => ({ obstacles: heavy, carHits: [{ carId: 2, impactSpeed: 20 }] }));
    t.reset(9);
    const again = run(t, 300);
    const fresh = run(new NpcTraffic(g, { seed: 9, params: { carCount: 30 } }), 300);
    expect(JSON.stringify(again)).toBe(JSON.stringify(fresh));
    expect(again.metrics.stuckRemovals).toBe(0);
  });
});

describe('admin parameters', () => {
  it('map the M1 registry names to traffic parameters', () => {
    expect(
      trafficParamChanges({
        'physics.npc_count': 25,
        'physics.npc_speed_mps': 9,
        'physics.npc_hit_stop_s': 4,
        'physics.grip': 0.5, // not a traffic parameter
      }),
    ).toEqual({ carCount: 25, maxSpeed: 9, hitStopTime: 4 });
    expect(trafficParamChanges({ 'obstacles.heavy_traffic.effect': 0.5 })).toEqual({
      heavyTrafficExtraCars: 4,
      heavyTrafficSpeedFactor: 0.6,
    });
    expect(heavyTrafficFromEffect(0)).toEqual({ heavyTrafficExtraCars: 0, heavyTrafficSpeedFactor: 1 });
    expect(heavyTrafficFromEffect(1).heavyTrafficExtraCars).toBe(8);
  });
});
