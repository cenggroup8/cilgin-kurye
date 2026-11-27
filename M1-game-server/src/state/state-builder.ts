// Durum kurucu (M1-1, plan 3.5).
// Tick sonunda dünya durumundan dondurulmuş oyun durumu ve tahta durumu üretir.

import type {
  DeliveryState,
  MergedControl,
  NpcCar,
  ObstacleEntry,
  Phase,
  PlayerSlot,
  Pose,
  QuakeState,
  TeamScore,
} from "../loop/types.js";
import type { WorldState } from "./world.js";
import { TICK_RATE, MATCH_DURATION_TICKS } from "./world.js";

// ── Game state (M2 → phones and admin) ─────────────────────────────

export interface PlayerState {
  index: number;
  team: number;
  name: string;
  isBot: boolean;
  connected: boolean;
  pose: Readonly<Pose>;
  control: Readonly<MergedControl>;
  delivery: Readonly<DeliveryState>;
  penaltySeconds: number;
}

export interface GameState {
  readonly tick: number;
  readonly phase: Phase;
  readonly gameTimeSeconds: number;
  readonly remainingSeconds: number;
  readonly players: readonly Readonly<PlayerState>[];
  readonly scores: readonly Readonly<TeamScore>[];
  readonly obstacles: readonly Readonly<ObstacleEntry>[];
  readonly obstacleVersion: number;
  readonly quake: Readonly<QuakeState> | null;
  readonly npcCars: readonly Readonly<NpcCar>[];
}

// ── Board state (M2 → LED board) ──────────────────────────────────

export interface BoardPlayer {
  team: number;
  color: number; // 0 = light, 1 = dark tone
  x: number;
  y: number;
  fallen: boolean;
  findMe: boolean;
}

export interface BoardDeliveryPoint {
  team: number;
  x: number;
  y: number;
}

export interface BoardObstacle {
  type: string;
  segment: number;
  lane: number;
  pos: number;
}

export interface BoardState {
  readonly ph: Phase;
  readonly tl: number; // time left in seconds
  readonly p: readonly BoardPlayer[];
  readonly dp: readonly BoardDeliveryPoint[];
  readonly ob: readonly BoardObstacle[];
  readonly eq: { active: boolean; cx: number; cy: number; r: number } | null;
}

// ── Builder ────────────────────────────────────────────────────────

export function buildGameState(world: Readonly<WorldState>): GameState {
  const gameTimeSeconds = world.gameTimeTicks / TICK_RATE;
  const remainingSeconds = Math.max(0, (MATCH_DURATION_TICKS - world.gameTimeTicks) / TICK_RATE);

  const players: PlayerState[] = world.players.map((p, i) => ({
    index: p.index,
    team: p.team,
    name: p.name,
    isBot: p.isBot,
    connected: p.connected,
    pose: { ...world.poses[i]! },
    control: { ...world.controls[i]! },
    delivery: { ...world.deliveries[i]! },
    penaltySeconds: (world.penaltyTicks[i] ?? 0) / TICK_RATE,
  }));

  return {
    tick: world.tick,
    phase: world.phase,
    gameTimeSeconds,
    remainingSeconds,
    players,
    scores: world.scores.map((s) => ({ ...s })),
    obstacles: world.obstacles.map((o) => ({ ...o })),
    obstacleVersion: world.obstacleVersion,
    quake: world.quake ? { ...world.quake } : null,
    npcCars: world.npcCars.map((c) => ({ ...c })),
  };
}

export function buildBoardState(world: Readonly<WorldState>): BoardState {
  const tl = Math.max(0, (MATCH_DURATION_TICKS - world.gameTimeTicks) / TICK_RATE);

  const p: BoardPlayer[] = world.players
    .filter((pl) => pl.connected || pl.isBot)
    .map((pl) => ({
      team: pl.team,
      color: pl.index % 2, // 0 = light, 1 = dark
      x: world.poses[pl.index]!.x,
      y: world.poses[pl.index]!.y,
      fallen: world.poses[pl.index]!.fallen,
      findMe: world.deliveries[pl.index]!.findMeCooldown > 0,
    }));

  const dp: BoardDeliveryPoint[] = world.deliveries
    .filter((d) => d.targetPoint >= 0)
    .map((d, i) => ({
      team: world.players[i]!.team,
      x: d.compassX,
      y: d.compassY,
    }));

  const ob: BoardObstacle[] = world.obstacles.map((o) => ({
    type: o.type,
    segment: o.segment,
    lane: o.lane,
    pos: o.pos,
  }));

  const eq = world.quake
    ? { active: world.quake.active, cx: world.quake.centerX, cy: world.quake.centerY, r: world.quake.radius }
    : null;

  return { ph: world.phase, tl, p, dp, ob, eq };
}
