// The admin parameters of the whole game (M1-5).
// Names come from the groups of the admin page (v2.1 section 9.5).
// The minimum, maximum and start values are a PROPOSAL: the owner module
// corrects them when it writes its code. Change values here, not in the code
// that uses them.

import type { ParamDef } from "./params.js";

export const PLAYERS = 8;
export const OBSTACLE_TYPES = ["heavy_traffic", "road_work", "accident", "puddle"] as const;
export type ObstacleType = (typeof OBSTACLE_TYPES)[number];

/**
 * Lane of an obstacle (contracts/README.md): 0 = the whole road.
 * 1 and 2 drive in the direction of the segment (h_r_c to the east, v_r_c to the south),
 * 3 and 4 the other way. 1 and 3 are next to the centre line.
 */
export const MAX_LANE = 4;

function game(): ParamDef[] {
  return [
    { name: "game.bots", group: "game", min: 0, max: 8, start: 8, integer: true, owner: "M1", label: "Bots that fill empty places at the start" },
    { name: "game.penalty_s", group: "game", min: 0, max: 15, start: 3, owner: "M1", label: "Penalty time after a fall (s)" },
    { name: "game.delivery_base", group: "game", min: 0, max: 1000, start: 100, integer: true, owner: "M1", label: "Base points of a delivery" },
    { name: "game.delivery_bonus", group: "game", min: 0, max: 50, start: 2, owner: "M1", label: "Bonus points per second of expected travel time" },
    { name: "game.delivery_radius_m", group: "game", min: 1, max: 15, start: 4, owner: "M1", label: "Size of the delivery area (m)" },
  ];
}

function obstacles(): ParamDef[] {
  return OBSTACLE_TYPES.flatMap((t): ParamDef[] => [
    { name: `obstacles.${t}.rate_per_min`, group: "obstacles", min: 0, max: 10, start: 1, owner: "M1", label: `${t}: how often it appears by itself (per minute)` },
    { name: `obstacles.${t}.duration_s`, group: "obstacles", min: 5, max: 180, start: 30, owner: "M1", label: `${t}: how long it stays (s)` },
    { name: `obstacles.${t}.effect`, group: "obstacles", min: 0, max: 1, start: 0.5, owner: "M3", label: `${t}: strength of the effect (0–1)` },
  ]);
}

function players(): ParamDef[] {
  const out: ParamDef[] = [];
  for (let p = 0; p < PLAYERS; p++) {
    out.push(
      { name: `players.${p}.far_chance`, group: "players", min: 0, max: 1, start: 0.5, owner: "M1", label: `Player ${p}: chance of a far delivery point` },
      { name: `players.${p}.speed_factor`, group: "players", min: 0.5, max: 1.5, start: 1, owner: "M3", label: `Player ${p}: speed factor` },
    );
  }
  return out;
}

function physics(): ParamDef[] {
  return [
    { name: "physics.top_speed_mps", group: "physics", min: 5, max: 30, start: 15, owner: "M3", label: "Top speed of a motorcycle (m/s)" },
    { name: "physics.grip", group: "physics", min: 0.1, max: 1.5, start: 1, owner: "M3", label: "Grip on a normal road" },
    { name: "physics.grip_puddle", group: "physics", min: 0.05, max: 1, start: 0.4, owner: "M3", label: "Grip on a water puddle" },
    { name: "physics.fall_speed_mps", group: "physics", min: 1, max: 20, start: 6, owner: "M3", label: "Hit speed above which a motorcycle falls (m/s)" },
    { name: "physics.npc_count", group: "physics", min: 0, max: 60, start: 20, integer: true, owner: "M3", label: "Number of NPC cars" },
    { name: "physics.npc_speed_mps", group: "physics", min: 5, max: 20, start: 11, owner: "M3", label: "Speed of an NPC car on a free road (m/s)" },
    { name: "physics.npc_hit_stop_s", group: "physics", min: 0, max: 10, start: 2.5, owner: "M3", label: "Time an NPC car stops after a motorcycle hits it (s)" },
    { name: "physics.bot_skill", group: "physics", min: 0, max: 1, start: 0.5, owner: "M3", label: "Bot skill (0 weak – 1 strong)" },
  ];
}

function quake(): ParamDef[] {
  return [
    { name: "quake.strength", group: "quake", min: 0, max: 2, start: 1, owner: "M1", label: "Factor on the strength of every earthquake" },
    { name: "quake.radius_per_mag_m", group: "quake", min: 2, max: 30, start: 10, owner: "M1", label: "Radius of the earthquake area per strength step (m)" },
    { name: "quake.duration_s", group: "quake", min: 1, max: 20, start: 5, owner: "M1", label: "How long the earthquake lasts (s)" },
    { name: "quake.road_close_s", group: "quake", min: 5, max: 180, start: 30, owner: "M1", label: "How long the road work from an earthquake stays (s)" },
    { name: "quake.grip", group: "quake", min: 0.05, max: 1, start: 0.5, owner: "M3", label: "Grip inside the earthquake area" },
  ];
}

/** Delay, jitter and loss for one up and one down queue (v2.1 section 6.5). */
function queues(prefix: string, group: "net" | "board", who: string): ParamDef[] {
  return (["up", "down"] as const).flatMap((dir): ParamDef[] => [
    { name: `${prefix}.${dir}.delay_ms`, group, min: 0, max: 2000, start: 0, integer: true, owner: "M2", label: `${who} ${dir}: added delay (ms)` },
    { name: `${prefix}.${dir}.jitter_ms`, group, min: 0, max: 1000, start: 0, integer: true, owner: "M2", label: `${who} ${dir}: jitter (ms)` },
    { name: `${prefix}.${dir}.loss_pct`, group, min: 0, max: 100, start: 0, owner: "M2", label: `${who} ${dir}: loss chance (%)` },
  ]);
}

function net(): ParamDef[] {
  const out: ParamDef[] = [];
  for (let p = 0; p < PLAYERS; p++) {
    out.push(...queues(`net.${p}`, "net", `Player ${p}`));
    out.push({ name: `net.${p}.fps_limit`, group: "net", min: 0, max: 120, start: 0, integer: true, owner: "M4", label: `Player ${p}: frame rate limit (0 = none)` });
  }
  return out;
}

function board(): ParamDef[] {
  return [
    ...queues("board", "board", "Board"),
    { name: "board.state_hz", group: "board", min: 10, max: 30, start: 30, integer: true, owner: "M2", label: "Board states per second" },
    { name: "board.brightness", group: "board", min: 0.1, max: 1, start: 0.5, owner: "M6", label: "LED brightness" },
    { name: "board.max_ma", group: "board", min: 500, max: 4000, start: 2000, integer: true, owner: "M6", label: "LED power limit (mA)" },
  ];
}

export const PARAMS: readonly ParamDef[] = [
  ...game(),
  ...obstacles(),
  ...players(),
  ...physics(),
  ...quake(),
  ...net(),
  ...board(),
];
