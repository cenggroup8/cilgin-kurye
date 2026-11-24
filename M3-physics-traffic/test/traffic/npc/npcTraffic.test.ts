import { describe, expect, it } from 'vitest';
import { NpcTraffic } from '../../../src/traffic/npc';
import { makeGridGraph } from '../../fakes/fakeRoadGraph';
import { DT, minCarDistance, minSameLaneGap, player, run } from './helpers';

const graph = makeGridGraph();

describe('NpcTraffic', () => {
  it('fills the city with the requested number of cars on the first tick', () => {
    const t = new NpcTraffic(graph, { seed: 1, params: { carCount: 80 } });
    const out = run(t, 1);
    expect(out.cars.length).toBe(80);
    expect(out.metrics.carCount).toBe(80);
  });

  it('gives exactly the same traffic for the same seed and inputs', () => {
    const inputs = (tick: number) => ({
      players: [player(0, 10 + tick * 0.2, 0, 0, 6), player(1, 100, 100)],
      carHits: tick === 200 ? [{ carId: 3, impactSpeed: 9 }] : [],
    });
    const a = run(new NpcTraffic(graph, { seed: 42, params: { carCount: 70 } }), 900, inputs);
    const b = run(new NpcTraffic(graph, { seed: 42, params: { carCount: 70 } }), 900, inputs);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = run(new NpcTraffic(graph, { seed: 43, params: { carCount: 70 } }), 900, inputs);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('needs no stuck removals at all with 100 cars in 10 minutes', () => {
    const t = new NpcTraffic(graph, { seed: 1, params: { carCount: 100 } });
    const out = run(t, 10 * 60 * 30);
    expect(out.metrics.stuckRemovals).toBe(0);
    expect(out.cars.length).toBe(100);
  });

  it('never locks up and cars never drive through each other in a long run with many cars', () => {
    const t = new NpcTraffic(graph, { seed: 7, params: { carCount: 150 } });
    const ticks = 10 * 60 * 30; // 10 minutes
    const window = 30 * 30; // 30 s
    let speedSum = 0;
    let minDist = Infinity;
    let minGap = Infinity;
    const windowMeans: number[] = [];
    const out = run(
      t,
      ticks,
      () => ({}),
      (o, tick) => {
        speedSum += o.metrics.meanSpeed;
        if ((tick + 1) % window === 0) {
          windowMeans.push(speedSum / window);
          speedSum = 0;
        }
        if (tick % 15 === 0) {
          minDist = Math.min(minDist, minCarDistance(o.cars));
          minGap = Math.min(minGap, minSameLaneGap(o.cars));
        }
      },
    );
    // Traffic keeps flowing in every 30 s window.
    expect(Math.min(...windowMeans)).toBeGreaterThan(3);
    // With this many cars on one lane roads queues do form. Only a few cars (of 150,
    // in 10 minutes) are removed because they waited too long; this is the safety
    // valve from the module document that keeps the city from locking up.
    expect(out.metrics.stuckRemovals).toBeLessThan(20);
    expect(out.cars.length).toBe(150);
    expect(minGap).toBeGreaterThanOrEqual(0);
    expect(minDist).toBeGreaterThan(1.5);
  });

  it('reaches a new car count within a few seconds', () => {
    const t = new NpcTraffic(graph, { seed: 3, params: { carCount: 40 } });
    run(t, 300);
    let out = run(t, 1, () => ({ params: { carCount: 140 } }));
    out = run(t, 3 * 30);
    expect(out.cars.length).toBe(140);
    run(t, 1, () => ({ params: { carCount: 20 } }));
    out = run(t, 3 * 30);
    expect(out.cars.length).toBe(20);
  });

  it('never adds a new car close to a player', () => {
    const players = [player(0, 0, 0), player(1, 125, 125), player(2, 250, 50), player(3, 50, 250)];
    const t = new NpcTraffic(graph, { seed: 5, params: { carCount: 30, minSpawnDistance: 40 } });
    const seen = new Set<number>();
    let closest = Infinity;
    run(
      t,
      1200,
      (tick) => ({ players, params: { carCount: tick < 600 ? 30 : 120 } }),
      (o) => {
        for (const c of o.cars) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          for (const p of players) closest = Math.min(closest, Math.hypot(c.x - p.x, c.y - p.y));
        }
      },
    );
    expect(seen.size).toBeGreaterThanOrEqual(120); // 30 at the start, 90 added later
    expect(closest).toBeGreaterThanOrEqual(40);
  });

  it('never drives onto a road closed by road work', () => {
    const closedRoad = 7; // a road in the middle of the city
    const closedEdges = new Set(graph.edges.filter((e) => e.roadId === closedRoad).map((e) => e.id));
    const t = new NpcTraffic(graph, { seed: 11, params: { carCount: 120 } });
    let onClosed = 0;
    run(
      t,
      3 * 60 * 30,
      () => ({ obstacles: [{ id: 1, type: 'roadWork', roadId: closedRoad }] }),
      (o) => {
        for (const c of o.cars) if (c.edgeId !== null && closedEdges.has(c.edgeId)) onClosed++;
      },
    );
    expect(onClosed).toBe(0);
  });

  it('empties a road soon after road work closes it', () => {
    const closedRoad = 7;
    const closedEdges = new Set(graph.edges.filter((e) => e.roadId === closedRoad).map((e) => e.id));
    const t = new NpcTraffic(graph, { seed: 12, params: { carCount: 150 } });
    run(t, 600);
    const obstacles = [{ id: 1, type: 'roadWork' as const, roadId: closedRoad }];
    const out = run(t, 15 * 30, () => ({ obstacles }));
    expect(out.cars.filter((c) => c.edgeId !== null && closedEdges.has(c.edgeId))).toHaveLength(0);
  });

  it('stops a car after a soft hit and drives on later', () => {
    const t = new NpcTraffic(graph, { seed: 2, params: { carCount: 20, hitStopTime: 2 } });
    run(t, 60);
    let out = run(t, 1, () => ({ carHits: [{ carId: 5, impactSpeed: 3 }] }));
    let car = out.cars.find((c) => c.id === 5)!;
    expect(car.state).toBe('stopped');
    expect(car.speed).toBe(0);
    out = run(t, 2 * 30 + 5);
    car = out.cars.find((c) => c.id === 5)!;
    expect(car.state).toBe('driving');
  });

  it('pushes a car off the road after a hard hit and removes it later', () => {
    const t = new NpcTraffic(graph, { seed: 2, params: { carCount: 20, offroadTime: 3 } });
    run(t, 60);
    let out = run(t, 1, () => ({ carHits: [{ carId: 5, impactSpeed: 12 }] }));
    const car = out.cars.find((c) => c.id === 5)!;
    expect(car.state).toBe('offroad');
    expect(car.edgeId).toBeNull();
    out = run(t, 3 * 30 + 5);
    expect(out.cars.find((c) => c.id === 5)).toBeUndefined();
    expect(out.cars.length).toBe(20); // a new car replaced it
  });

  it('adds extra slow cars on a heavy traffic road and removes them when it ends', () => {
    const road = 20;
    const roadEdges = new Set(graph.edges.filter((e) => e.roadId === road).map((e) => e.id));
    const t = new NpcTraffic(graph, {
      seed: 9,
      params: { carCount: 40, heavyTrafficExtraCars: 4, heavyTrafficSpeedFactor: 0.4, maxSpeed: 11 },
    });
    run(t, 30);
    const heavy = [{ id: 99, type: 'heavyTraffic' as const, roadId: road }];
    let out = run(t, 60, () => ({ obstacles: heavy }));
    expect(out.cars.length).toBe(44);
    // Later the extra cars still drive back and forth on their road. Some may be
    // inside an intersection (turning around) at a given moment, so count over time.
    let onRoadMax = 0;
    run(
      t,
      300,
      () => ({ obstacles: heavy }),
      (o) => {
        const n = o.cars.filter((c) => c.edgeId !== null && roadEdges.has(c.edgeId)).length;
        onRoadMax = Math.max(onRoadMax, n);
      },
    );
    expect(onRoadMax).toBeGreaterThanOrEqual(4);
    expect(out.cars.length).toBe(44);
    out = run(t, 3 * 30);
    expect(out.cars.length).toBe(40);
  });

  it('keeps a safe gap behind a motorcycle standing on the road', () => {
    // Player stands in the right lane of the eastbound road at y = 0.
    const p = player(0, 75, -1.75, 0, 0);
    const t = new NpcTraffic(graph, { seed: 4, params: { carCount: 120, minSpawnDistance: 20 } });
    let closest = Infinity;
    run(
      t,
      60 * 30,
      () => ({ players: [p] }),
      (o) => {
        for (const c of o.cars) {
          if (c.state === 'offroad') continue;
          closest = Math.min(closest, Math.hypot(c.x - p.x, c.y - p.y));
        }
      },
    );
    // Car half length 2.25 + motorcycle half length 1.1.
    expect(closest).toBeGreaterThan(3.3);
  });

  it('reports metrics that match the cars', () => {
    const t = new NpcTraffic(graph, { seed: 6, params: { carCount: 50 } });
    const out = run(t, 300);
    const mean = out.cars.reduce((s, c) => s + c.speed, 0) / out.cars.length;
    expect(out.metrics.carCount).toBe(out.cars.length);
    expect(out.metrics.meanSpeed).toBeCloseTo(mean, 9);
    t.countBotRouteChange(2);
    expect(run(t, 1).metrics.botRouteChanges).toBe(2);
  });

  it('works with two lanes in each direction', () => {
    const g2 = makeGridGraph({ lanesPerDirection: 2 });
    const t = new NpcTraffic(g2, { seed: 8, params: { carCount: 150 } });
    let minGap = Infinity;
    let speedSum = 0;
    const ticks = 3 * 60 * 30;
    run(
      t,
      ticks,
      () => ({}),
      (o, tick) => {
        speedSum += o.metrics.meanSpeed;
        if (tick % 15 === 0) minGap = Math.min(minGap, minSameLaneGap(o.cars));
      },
    );
    expect(minGap).toBeGreaterThanOrEqual(0);
    expect(speedSum / ticks).toBeGreaterThan(3);
  });

  it('uses the tick length it is given', () => {
    expect(DT).toBeCloseTo(1 / 30);
  });
});
