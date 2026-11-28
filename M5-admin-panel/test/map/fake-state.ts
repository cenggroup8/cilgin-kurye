// Fake AdminState generator for the M5-3 map demo.
// Produces a stream of states with moving players, NPC cars and obstacles.

import type { AdminState } from '../../src/comm/protocol.ts';
import { SEGMENTS, SEGMENT_LENGTH, segmentToWorld, STORES, WORLD_SIZE } from '../../src/map/city.ts';

const OBSTACLE_TYPES = ['heavy_traffic', 'road_work', 'accident', 'puddle'] as const;

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function* fakeGameStates(durationSeconds: number, tickMs = 100): Generator<AdminState> {
  const totalTicks = Math.ceil((durationSeconds * 1000) / tickMs);

  // 8 players, one per team corner and 4 more spread around
  const playerSegs = [0, 4, 25, 29, 32, 38, 50, 55];
  const playerTeams = [0, 1, 2, 3, 0, 1, 2, 3];

  // 20 NPC cars on random segments
  const npcSegs = Array.from({ length: 20 }, (_, i) => i % SEGMENTS.length);
  const npcPos = Array.from({ length: 20 }, () => Math.random());

  // Some obstacles
  const obstacles: AdminState['obstacles'] = [
    { id: 1, type: 'road_work', segment: 12, lane: 0, pos: 0.5 },
    { id: 2, type: 'accident', segment: 35, lane: 1, pos: 0.3 },
    { id: 3, type: 'puddle', segment: 48, lane: 2, pos: 0.7 },
    { id: 4, type: 'heavy_traffic', segment: 7, lane: 0, pos: 0.4 },
  ];

  // Delivery points at fixed positions
  const deliveryPoints: AdminState['deliveryPoints'] = [
    { id: 0, x: 250, z: 100 },
    { id: 1, x: 150, z: 300 },
    { id: 2, x: 350, z: 400 },
    { id: 3, x: 400, z: 200 },
  ];

  for (let tick = 0; tick < totalTicks; tick++) {
    const t = tick / totalTicks;
    const timeLeftSeconds = Math.max(0, durationSeconds - (tick * tickMs) / 1000);

    // Move players along their segments, wrapping around
    const players = playerSegs.map((segId, i) => {
      const speed = 0.002 + i * 0.0003;
      const pos = wrap(t * speed * totalTicks, 1);
      const seg = SEGMENTS[segId % SEGMENTS.length];
      const world = segmentToWorld(seg.id, 1, pos);
      return {
        id: i,
        team: playerTeams[i],
        x: world.x,
        z: world.z,
        fallen: tick % 300 >= 290 && tick % 300 < 295 && i === 0,
      };
    });

    // Move NPC cars
    const npcCars = npcSegs.map((segId, i) => {
      npcPos[i] = wrap(npcPos[i] + 0.003, 1);
      const seg = SEGMENTS[segId % SEGMENTS.length];
      const world = segmentToWorld(seg.id, (i % 2) + 1, npcPos[i]);
      return { id: 100 + i, x: world.x, z: world.z };
    });

    // Add/remove obstacles over time
    const liveObstacles = obstacles.filter((_, i) => {
      const cycleLen = 100 + i * 30;
      return (tick % cycleLen) < cycleLen * 0.8;
    });

    yield {
      phase: 'playing' as const,
      timeLeftSeconds,
      gameCode: 'DEMO',
      players,
      npcCars,
      obstacles: liveObstacles,
      deliveryPoints,
    };
  }
}
