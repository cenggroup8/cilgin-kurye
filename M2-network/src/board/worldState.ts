// Board state from the world of M1 (M2-4). contracts/board_protocol.md section 4:
// M1 gives the board state in world coordinates (x, z in metres, heading in degrees
// clockwise from north, as in contracts/README.md); the board link turns it into the
// short lists of the `S` message here, so the conversion is in one place.

/** Game phases, the same names as M1-2. */
export type WorldPhase = "lobby" | "countdown" | "playing" | "paused" | "ended";

/** Obstacle names, the same as the admin commands of M1-5. */
export type WorldObstacleType = "heavy_traffic" | "road_work" | "accident" | "puddle";

export interface WorldPlayer {
  no: number;
  team: number;
  /** 0 light, 1 dark. */
  tone: 0 | 1;
  x: number;
  z: number;
  heading: number;
  speed: number;
  inGame: boolean;
  fallen: boolean;
  carrying: boolean;
  bot: boolean;
  findMe: boolean;
}

export interface WorldDelivery {
  /** Player that owns the point. */
  player: number;
  x: number;
  z: number;
  /** True for the flash right after a delivery. */
  delivered: boolean;
}

export interface WorldObstacle {
  segment: number;
  type: WorldObstacleType;
  /** 0 the whole road, 1–4 a lane. */
  lane: number;
}

export interface WorldQuake {
  x: number;
  z: number;
  mag: number;
  /** Milliseconds since the earthquake started. */
  ms: number;
}

/** What M1 gives after each tick. */
export interface WorldBoardState {
  phase: WorldPhase;
  timeLeft_s: number;
  players: WorldPlayer[];
  deliveries: WorldDelivery[];
  obstacles: WorldObstacle[];
  /** Null when there is no earthquake. */
  quake: WorldQuake | null;
}

/** Side of the city in metres (`world.size_m` in contracts/city_plan.json). */
export const WORLD_SIZE_M = 500;

const PHASE: Record<WorldPhase, number> = { lobby: 0, countdown: 1, playing: 2, paused: 3, ended: 4 };
const OBSTACLE: Record<WorldObstacleType, number> = { heavy_traffic: 1, road_work: 2, accident: 3, puddle: 4 };

/** Flags of a player (board_protocol.md, `p` place 3). */
export const FLAG = { inGame: 1, fallen: 2, carrying: 4, bot: 8, findMe: 16 } as const;

/** The `d` of an `S` message. Unknown phases and obstacle types throw, so M1 hears about them in tests. */
export function toBoardState(w: WorldBoardState, sizeM = WORLD_SIZE_M): Record<string, unknown> {
  const u = (x: number) => clamp01(x / sizeM);
  const ph = PHASE[w.phase];
  if (ph === undefined) throw new Error(`unknown phase ${String(w.phase)}`);
  return {
    ph,
    tl: Math.max(0, Math.round(w.timeLeft_s)),
    p: w.players.map((p) => [
      p.no,
      p.team,
      p.tone,
      (p.inGame ? FLAG.inGame : 0) |
        (p.fallen ? FLAG.fallen : 0) |
        (p.carrying ? FLAG.carrying : 0) |
        (p.bot ? FLAG.bot : 0) |
        (p.findMe ? FLAG.findMe : 0),
      u(p.x),
      u(p.z),
      heading(p.heading),
      p.speed,
    ]),
    dp: w.deliveries.map((d) => [d.player, u(d.x), u(d.z), d.delivered ? 1 : 0]),
    ob: w.obstacles.map((o) => {
      const type = OBSTACLE[o.type];
      if (type === undefined) throw new Error(`unknown obstacle type ${String(o.type)}`);
      return [o.segment, type, o.lane];
    }),
    // Proposal in board_protocol.md: an empty list when there is no earthquake.
    eq: w.quake ? [1, u(w.quake.x), u(w.quake.z), w.quake.mag, Math.max(0, Math.round(w.quake.ms))] : [],
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0 ≤ heading < 360. */
function heading(h: number): number {
  const r = h % 360;
  return r < 0 ? r + 360 : r;
}
