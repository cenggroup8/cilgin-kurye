/**
 * M3-5 demo: bots deliver in a city with fake M1 data, no server.
 *
 *   npm run demo:bots                  # 6 x 6 test grid
 *   npm run demo:bots -- path/to/city_plan.json
 *
 * Prints, for skill 0, 0.5 and 1: the time for four deliveries in an empty
 * city, and the same with a road closed on the way (route changes).
 */
import { existsSync, readFileSync } from 'node:fs';
import { BotFleet } from '../src/traffic/bots/index.js';
import type { CityPlan } from '../src/traffic/graph/cityPlan.js';
import type { Obstacle } from '../src/common/types.js';
import { gridPlan, runDeliveries, SimBike } from '../test/traffic/bots/helpers.js';

const file = process.argv[2];
const plan: CityPlan = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : gridPlan();
const orders = plan.delivery_candidates.filter((_, i) => i % 13 === 7).slice(0, 4).map((c) => c.id);

console.log('orders (delivery candidates):', orders.join(', '));
console.log('skill  empty city   road closed   route changes');
for (const skill of [0, 0.5, 1]) {
  const times: string[] = [];
  let changes = 0;
  for (const close of [false, true]) {
    const fleet = new BotFleet(plan);
    const bot = fleet.addBot(0, 0, { skill, seed: 1 });
    const store = fleet.planner.graph.nodes[bot.storeNode];
    const bike = new SimBike(store.x, store.y, 0);
    const obstacles: Obstacle[] = [];
    const r = runDeliveries(fleet, bot, bike, orders, {
      maxSeconds: 1800,
      onTick: () => {
        if (close && obstacles.length === 0 && bot.phase === 'toDelivery' && bot.routeEdges.length > 3) {
          obstacles.push({ id: 1, type: 'roadWork', roadId: fleet.planner.graph.edges[bot.routeEdges[2]].roadId });
          fleet.update(obstacles);
        }
      },
    });
    times.push(`${r.deliveries}/${orders.length} in ${r.seconds.toFixed(0).padStart(4)} s`);
    if (close) changes = fleet.routeChanges();
  }
  console.log(`${skill.toFixed(1).padEnd(6)} ${times[0].padEnd(12)} ${times[1].padEnd(13)} ${changes}`);
}
