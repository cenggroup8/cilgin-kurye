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

// ── Board state (M2 → LED board, WorldBoardState uyumlu) ──────────

export interface BoardPlayer {
  no: number;      // oyuncu slot index (0–7)
  team: number;
  tone: number;    // 0 = light, 1 = dark
  x: number;
  z: number;
  heading: number; // derece
  speed: number;
  inGame: boolean;
  fallen: boolean;
  carrying: boolean;
  bot: boolean;
  findMe: boolean;
}

export interface BoardDeliveryPoint {
  player: number;  // sahip oyuncu slot index
  x: number;
  z: number;
  delivered: boolean;
}

export interface BoardObstacle {
  segment: number;
  type: "heavy_traffic" | "road_work" | "accident" | "puddle";
  lane: number;
}

export interface BoardState {
  readonly phase: Phase;
  readonly timeLeft_s: number;
  readonly players: readonly BoardPlayer[];
  readonly deliveries: readonly BoardDeliveryPoint[];
  readonly obstacles: readonly BoardObstacle[];
  readonly quake: { x: number; z: number; mag: number; ms: number } | null;
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
  const timeLeft_s = Math.max(0, (MATCH_DURATION_TICKS - world.gameTimeTicks) / TICK_RATE);

  const players: BoardPlayer[] = world.players
    .filter((pl) => pl.connected || pl.isBot)
    .map((pl) => ({
      no: pl.index,
      team: pl.team,
      tone: pl.index % 2,
      x: world.poses[pl.index]!.x,
      z: world.poses[pl.index]!.z,
      heading: world.poses[pl.index]!.heading,
      speed: world.poses[pl.index]!.speed,
      inGame: pl.connected,
      fallen: world.poses[pl.index]!.fallen,
      carrying: world.deliveries[pl.index]!.hasPackage,
      bot: pl.isBot,
      findMe: world.deliveries[pl.index]!.findMeCooldown > 0,
    }));

  // Fix: map ile index al, sonra filtrele — filter sonrası i yanlış oluyordu
  const deliveries: BoardDeliveryPoint[] = world.deliveries
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.targetPoint >= 0)
    .map(({ d, i }) => ({
      player: i,
      x: d.compassTarget.x,
      z: d.compassTarget.z,
      delivered: false, // M1-3 teslimatı işaretler
    }));

  const obstacles: BoardObstacle[] = world.obstacles.map((o) => ({
    segment: o.segment,
    type: o.type,
    lane: o.lane,
  }));

  const quake = world.quake
    ? {
        x: world.quake.centerX,
        z: world.quake.centerZ,
        mag: world.quake.magnitude,
        ms: (world.tick - world.quake.startTick) * (1000 / TICK_RATE),
      }
    : null;

  return { phase: world.phase, timeLeft_s, players, deliveries, obstacles, quake };
}
