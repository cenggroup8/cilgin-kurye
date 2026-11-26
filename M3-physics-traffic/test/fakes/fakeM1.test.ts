import { describe, expect, it } from 'vitest';
import { BIKE_STAGES, EMPTY_STAGES } from '../../src/physics';
import type { NpcCarPose } from '../../src/traffic/npc';
import { CITY_PLAN, m3City } from './cityPlan';
import { FakeM1, type Scenario } from './fakeM1';

const ride: Scenario = {
  seed: 11,
  players: [0, 3, 5, 6],
  npcCars: 20,
  control: (t, p) => ({ throttle: t < 150 ? 1 : 0, brake: t >= 250 ? 1 : 0, steer: p % 2 === 0 ? 0.3 : -0.3 }),
};

describe('city plan in M3 coordinates', () => {
  it('has the city of the contract', () => {
    expect(CITY_PLAN.nodes).toHaveLength(36);
    expect(CITY_PLAN.segments).toHaveLength(60);
    expect(CITY_PLAN.buildings).toHaveLength(25);
    const city = m3City();
    expect(city.stores.map((s) => [s.team, s.x, s.y])).toEqual([
      [0, 18, -18],
      [1, 482, -18],
      [2, 18, -482],
      [3, 482, -482],
    ]);
  });

  it('uses the node numbers of the plan in the road graph', () => {
    const { graph } = m3City();
    for (const n of CITY_PLAN.nodes) {
      expect(graph.nodes[n.id].x).toBe(n.x);
      expect(graph.nodes[n.id].y).toBe(-n.z);
    }
  });
});

describe('fake M1', () => {
  it('starts every motorcycle at the store of its team', () => {
    const m1 = new FakeM1(ride);
    const stores = m3City().stores;
    for (const p of ride.players) {
      const b = m1.physics.bikes.get(p)!;
      expect([b.x, b.y]).toEqual([stores[Math.floor(p / 2)].x, stores[Math.floor(p / 2)].y]);
    }
  });

  it('calls the traffic part first and gives its cars to the physics part in the same tick', () => {
    let seen: readonly NpcCarPose[] = [];
    const m1 = new FakeM1(ride, {
      ...EMPTY_STAGES,
      ...BIKE_STAGES,
      wallsAndObstacles: (ctx) => {
        seen = ctx.input.npcCars;
      },
    });
    const out = m1.step();
    expect(out.cars.length).toBeGreaterThan(0);
    expect(seen).toBe(out.cars);
  });

  it('applies the events of the scenario at their tick', () => {
    const m1 = new FakeM1({
      ...ride,
      events: [
        { at: 10, obstacles: [{ id: 1, type: 'roadWork', roadId: 7 }], quake: { x: 250, y: -250, radius: 80, strength: 6 }, fall: [3] },
        { at: 40, standUp: [3], quake: null },
      ],
    });
    m1.run(11);
    expect(m1.obstacles).toHaveLength(1);
    expect(m1.quake?.strength).toBe(6);
    expect(m1.physics.bikes.get(3)!.fallen).toBe(true);
    m1.run(30);
    expect(m1.quake).toBeNull();
    expect(m1.physics.bikes.get(3)!.fallen).toBe(false);
  });

  it('plays the same scenario twice with exactly the same result', () => {
    const a = new FakeM1(ride).run(300);
    const b = new FakeM1(ride).run(300);
    expect(a[299]).toEqual(b[299]);
    expect(a[299].physics.bikes[0].speed).toBe(0);
  });
});
