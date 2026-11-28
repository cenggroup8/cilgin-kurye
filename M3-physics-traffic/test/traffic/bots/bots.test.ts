import { describe, expect, it } from 'vitest';
import { BotFleet, skillFromLevel } from '../../../src/traffic/bots/index.js';
import type { Obstacle } from '../../../src/common/types.js';
import { gridPlan, runDeliveries, SimBike } from './helpers.js';

const ORDERS = [7, 20, 33, 59];

function setup(skill = 0.5) {
  const fleet = new BotFleet(gridPlan());
  const bot = fleet.addBot(0, 0, { skill, seed: 7 });
  const bike = new SimBike(0, 0, 0);
  return { fleet, bot, bike };
}

describe('bot drivers (M3-5)', () => {
  it('finishes its deliveries in an empty city', () => {
    const { fleet, bot, bike } = setup();
    const r = runDeliveries(fleet, bot, bike, ORDERS, { maxSeconds: 600 });
    expect(r.deliveries).toBe(ORDERS.length);
    expect(bot.routeChanges).toBe(0);
  });

  it('makes the same control record as a phone', () => {
    const { fleet, bot, bike } = setup();
    const { controls } = runDeliveries(fleet, bot, bike, [7], { maxSeconds: 120 });
    controls.forEach((c, i) => {
      expect(Object.keys(c).sort()).toEqual(['brake', 'seq', 'steer', 'throttle']);
      expect(c.seq).toBe(i + 1);
      expect(c.throttle).toBeGreaterThanOrEqual(0);
      expect(c.throttle).toBeLessThanOrEqual(1);
      expect(c.brake).toBeGreaterThanOrEqual(0);
      expect(c.brake).toBeLessThanOrEqual(1);
      expect(Math.abs(c.steer)).toBeLessThanOrEqual(1);
    });
  });

  it('is the same for the same seed', () => {
    const a = setup();
    const b = setup();
    const ra = runDeliveries(a.fleet, a.bot, a.bike, [7, 20], { maxSeconds: 300 });
    const rb = runDeliveries(b.fleet, b.bot, b.bike, [7, 20], { maxSeconds: 300 });
    expect(rb.controls).toEqual(ra.controls);
  });

  it('drives visibly slower with a lower skill', () => {
    const times = [0, 0.5, 1].map((skill) => {
      const { fleet, bot, bike } = setup(skill);
      const r = runDeliveries(fleet, bot, bike, ORDERS, { maxSeconds: 1200 });
      expect(r.deliveries).toBe(ORDERS.length);
      return r.seconds;
    });
    expect(times[0]).toBeGreaterThan(times[1] * 1.3);
    expect(times[1]).toBeGreaterThan(times[2] * 1.1);
    expect(skillFromLevel(0).maxSpeedMps).toBeLessThan(skillFromLevel(1).maxSpeedMps);
  });

  it('takes another way when a road on its route is closed', () => {
    const { fleet, bot, bike } = setup();
    const obstacles: Obstacle[] = [];
    let closed = -1;
    const r = runDeliveries(fleet, bot, bike, [59], {
      maxSeconds: 600,
      onTick: (t) => {
        if (closed < 0 && t > 15 && bot.phase === 'toDelivery' && bot.routeEdges.length > 3) {
          // Close a road two edges ahead of the bot.
          closed = fleet.planner.graph.edges[bot.routeEdges[2]].roadId;
          obstacles.push({ id: 1, type: 'roadWork', roadId: closed });
          fleet.update(obstacles);
        }
      },
    });
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(r.deliveries).toBe(1);
    expect(bot.routeChanges).toBeGreaterThanOrEqual(1);
    expect(fleet.routeChanges()).toBe(bot.routeChanges);
    expect(bot.routeEdges.map((e) => fleet.planner.graph.edges[e].roadId)).not.toContain(closed);
  });

  it('waits while fallen and goes on in the same state', () => {
    const { fleet, bot, bike } = setup();
    let phaseAtFall: string | null = null;
    const r = runDeliveries(fleet, bot, bike, [20], {
      maxSeconds: 400,
      onTick: (t) => {
        if (t > 20 && t < 23) {
          if (!bike.fallen) { phaseAtFall = bot.phase; bike.fallen = true; bike.speed = 0; }
          const c = bot.tick({ pose: bike, carrying: true, delivery: 20 }, 0);
          expect([c.throttle, c.brake, c.steer]).toEqual([0, 0, 0]);
        } else if (bike.fallen && t >= 23) {
          bike.fallen = false;
          expect(bot.phase).toBe(phaseAtFall);
        }
      },
    });
    expect(phaseAtFall).not.toBeNull();
    expect(r.deliveries).toBe(1);
  });

  it('asks for a new route when it is stuck', () => {
    const { fleet, bot, bike } = setup();
    // Something stands in front of the bot for 10 s and does not move.
    let wall: { x: number; y: number; speed: number } | null = null;
    const r = runDeliveries(fleet, bot, bike, [33], {
      maxSeconds: 600,
      neighbours: (t) => {
        if (t > 20 && t < 30) {
          wall ??= { x: bike.x + Math.cos(bike.heading) * 25, y: bike.y + Math.sin(bike.heading) * 25, speed: 0 };
          return [wall];
        }
        return [];
      },
    });
    expect(r.deliveries).toBe(1);
    expect(bot.routeChanges).toBeGreaterThanOrEqual(1);
  });

  it('keeps a gap to a slow car in front', () => {
    const { fleet, bot, bike } = setup(1);
    let minGap = Infinity;
    const car = { x: 0, y: 0, speed: 4 };
    let placed = false;
    runDeliveries(fleet, bot, bike, [59], {
      maxSeconds: 60,
      neighbours: (t) => {
        if (t < 15 || t > 40 || bot.phase !== 'toDelivery') return [];
        if (!placed) { car.x = bike.x + Math.cos(bike.heading) * 30; car.y = bike.y + Math.sin(bike.heading) * 30; placed = true; }
        car.x += Math.cos(bike.heading) * car.speed / 30;
        car.y += Math.sin(bike.heading) * car.speed / 30;
        minGap = Math.min(minGap, Math.hypot(car.x - bike.x, car.y - bike.y));
        return [car];
      },
    });
    expect(placed).toBe(true);
    expect(minGap).toBeGreaterThan(4);
  });
});
