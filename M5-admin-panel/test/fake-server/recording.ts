// A recorded game for the fake server (M5-2, #49).
// The same seed always gives the same game, so a demo or a test looks the same every time.
// Positions follow the city plan of contracts/: a 6 × 6 grid of intersections, 100 m apart,
// x to the east and z to the south. Obstacles use the segment and lane numbers of contracts/README.md.

export const GAME_SECONDS = 300;
export const TEAMS = 4;
export const PLAYER_COUNT = 8;
export const OBSTACLE_TYPES = ['heavy_traffic', 'road_work', 'accident', 'puddle'] as const;
const BLOCK_M = 100;

export type RecordedEvent =
  | { t: number; kind: 'delivery'; player: number; points: number; timeS: number; distanceM: number }
  | { t: number; kind: 'fall'; player: number }
  | { t: number; kind: 'obstacle_add'; id: number; type: string; segment: number; lane: number; pos: number }
  | { t: number; kind: 'obstacle_remove'; id: number }
  | { t: number; kind: 'quake'; mag: number; zone: number };

export interface RecordedPlayer {
  id: number;
  team: number;
  /** Intersections (row, column) that the player rides around, again and again. */
  loop: readonly (readonly [number, number])[];
  speedMps: number;
}

export interface Recording {
  seed: number;
  seconds: number;
  players: readonly RecordedPlayer[];
  npcCars: readonly RecordedPlayer[];
  events: readonly RecordedEvent[];
}

/** Small seeded random numbers (mulberry32), the same on every computer. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A rectangle of blocks starting at (r, c), as a closed loop of intersections. */
function rectangle(r: number, c: number, h: number, w: number): [number, number][] {
  return [[r, c], [r, c + w], [r + h, c + w], [r + h, c]];
}

export function makeRecording(seed = 396): Recording {
  const next = random(seed);
  const int = (n: number) => Math.floor(next() * n);
  // Team stores are in the four corners; each team rides near its corner.
  const corners: [number, number][] = [[0, 0], [0, 3], [3, 0], [3, 3]];
  const players = Array.from({ length: PLAYER_COUNT }, (_, id): RecordedPlayer => {
    const team = id % TEAMS;
    const r = corners[team][0] + int(2);
    const c = corners[team][1] + int(2);
    const h = Math.min(1 + int(2), 5 - r);
    const w = Math.min(1 + int(2), 5 - c);
    return { id, team, loop: rectangle(r, c, h, w), speedMps: 9 + next() * 4 };
  });
  const npcCars = Array.from({ length: 12 }, (_, id): RecordedPlayer =>
    ({ id, team: -1, loop: rectangle(int(4), int(4), 1 + int(1), 1 + int(1)), speedMps: 8 + next() * 4 }));

  const events: RecordedEvent[] = [];
  for (const { id } of players) {
    for (let t = 10 + next() * 20; t < GAME_SECONDS - 5; t += 20 + next() * 25) {
      const timeS = 15 + next() * 30;
      events.push({ t, kind: 'delivery', player: id, timeS, distanceM: timeS * (7 + next() * 3), points: 100 + Math.round(timeS * 2) });
    }
    for (let t = 30 + next() * 60; t < GAME_SECONDS; t += 60 + next() * 90) events.push({ t, kind: 'fall', player: id });
  }
  let obstacleId = 100;
  for (let t = 15; t < GAME_SECONDS - 20; t += 25 + next() * 20) {
    const id = obstacleId++;
    events.push({ t, kind: 'obstacle_add', id, type: OBSTACLE_TYPES[int(4)], segment: int(60), lane: int(5), pos: Number(next().toFixed(2)) });
    events.push({ t: t + 20 + next() * 30, kind: 'obstacle_remove', id });
  }
  events.push({ t: 150, kind: 'quake', mag: 6.5, zone: 4 });
  events.sort((a, b) => a.t - b.t);
  return { seed, seconds: GAME_SECONDS, players, npcCars, events };
}

/** Where a rider of the recording is after `seconds` of riding. */
export function positionAt(rider: RecordedPlayer, seconds: number): { x: number; z: number } {
  const points = rider.loop.map(([r, c]) => ({ x: c * BLOCK_M, z: r * BLOCK_M }));
  const lengths = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.abs(q.x - p.x) + Math.abs(q.z - p.z);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  let d = ((seconds * rider.speedMps) % total + total) % total;
  for (let i = 0; i < points.length; i++) {
    if (d <= lengths[i]) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const f = lengths[i] === 0 ? 0 : d / lengths[i];
      return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f };
    }
    d -= lengths[i];
  }
  return points[0];
}
