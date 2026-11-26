/**
 * NPC traffic demo with fake data (issue #41): npm run demo:npc
 *
 * Plays two minutes of traffic in the fake 6 x 6 city, with no other module:
 *   0 s   60 cars, two standing players
 *  30 s   admin sets 120 cars
 *  60 s   road work closes a road, heavy traffic on another road
 *  90 s   both obstacles end, admin sets 40 cars
 * Every 5 s it prints the traffic metrics, and at the end a map of the city.
 */
import type { Obstacle } from '../src/common/types.js';
import { NpcTraffic, type TrafficOutput } from '../src/traffic/npc/index.js';
import { makeGridGraph } from '../test/fakes/fakeRoadGraph.js';

const graph = makeGridGraph();
const traffic = new NpcTraffic(graph, { seed: 2026, params: { carCount: 60 } });
// Two players waiting at their stores, next to the road (not on it).
const players = [
  { id: 0, x: 15, y: 15, heading: 0, speed: 0, fallen: false },
  { id: 1, x: 235, y: 235, heading: 0, speed: 0, fallen: false },
];
const ROAD_WORK = 7;
const HEAVY = 33;

const dt = 1 / 30;
let out!: TrafficOutput;
let carCount = 60;
console.log(' time | cars | mean speed | stuck removals | event');
console.log('------+------+------------+----------------+------------------------------');
for (let tick = 0; tick <= 120 * 30; tick++) {
  const time = tick * dt;
  let event = '';
  if (tick === 30 * 30) (carCount = 120), (event = 'admin: 120 cars');
  if (tick === 60 * 30) event = `road work on road ${ROAD_WORK}, heavy traffic on road ${HEAVY}`;
  if (tick === 90 * 30) (carCount = 40), (event = 'obstacles end, admin: 40 cars');
  const obstacles: Obstacle[] =
    time >= 60 && time < 90
      ? [
          { id: 1, type: 'roadWork', roadId: ROAD_WORK },
          { id: 2, type: 'heavyTraffic', roadId: HEAVY },
        ]
      : [];
  out = traffic.step({ dt, players, obstacles, carHits: [], params: { carCount } });
  if (tick % (5 * 30) === 0 || event) {
    const m = out.metrics;
    console.log(
      `${time.toFixed(0).padStart(4)} s | ${String(m.carCount).padStart(4)} | ${(m.meanSpeed * 3.6).toFixed(1).padStart(6)} km/h | ${String(m.stuckRemovals).padStart(14)} | ${event}`,
    );
  }
}

// Map: one character is 5 m. Digits = number of cars in that cell, P = player.
const CELL = 5;
const size = Math.ceil(260 / CELL);
const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(' '));
for (const r of graph.roads) {
  const a = graph.nodes[r.a];
  const b = graph.nodes[r.b];
  const steps = Math.hypot(b.x - a.x, b.y - a.y) / CELL;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round((a.x + ((b.x - a.x) * i) / steps) / CELL);
    const y = Math.round((a.y + ((b.y - a.y) * i) / steps) / CELL);
    grid[y][x] = '.';
  }
}
const counts = new Map<string, number>();
for (const c of out.cars) {
  const key = `${Math.round(c.x / CELL)},${Math.round(c.y / CELL)}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [key, n] of counts) {
  const [x, y] = key.split(',').map(Number);
  if (grid[y]?.[x] !== undefined) grid[y][x] = n > 9 ? '#' : String(n);
}
for (const p of players) grid[Math.round(p.y / CELL)][Math.round(p.x / CELL)] = 'P';
console.log(`\nCity after 120 s (north is up, ${out.cars.length} cars):`);
for (let y = size - 1; y >= 0; y--) console.log('  ' + grid[y].join(''));
