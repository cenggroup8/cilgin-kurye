// Dünya durumu (M1-1, plan 3.2).
// Tek bir mutable nesne; tick içinde her paket kendi bölümünü yazar.
// Tick sonunda state-builder bunu dondurulmuş kopyaya çevirir.

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

export const TICK_RATE = 30;
export const MAX_PLAYERS = 8;
export const TEAMS = 4;
export const MATCH_DURATION_S = 300; // 5 minutes
export const MATCH_DURATION_TICKS = MATCH_DURATION_S * TICK_RATE;
export const COUNTDOWN_S = 3;
export const COUNTDOWN_TICKS = COUNTDOWN_S * TICK_RATE;

export interface WorldState {
  // Clock & phase (M1-1, M1-2)
  tick: number;
  phase: Phase;
  gameTimeTicks: number;    // ticks elapsed in playing phase
  countdownTicks: number;   // ticks remaining in countdown

  // Roster (M1-2)
  players: PlayerSlot[];

  // Controls & poses (M1-1)
  controls: MergedControl[];
  poses: Pose[];

  // Delivery (M1-3)
  deliveries: DeliveryState[];
  scores: TeamScore[];

  // Penalties (M1-4)
  penaltyTicks: number[]; // per player, ticks remaining

  // Obstacles (M1-4)
  obstacles: ObstacleEntry[];
  obstacleVersion: number;
  nextObstacleId: number;

  // Earthquake (M1-4)
  quake: QuakeState | null;

  // Traffic (M1-1, from M3)
  npcCars: NpcCar[];
  travelTimes: number[][];
}

export function defaultPose(): Pose {
  return { x: 0, y: 0, angle: 0, speed: 0, lean: 0, sliding: false, fallen: false };
}

export function defaultControl(player: number): MergedControl {
  return { player, seq: 0, throttle: 0, brake: 0, steer: 0 };
}

export function defaultDelivery(): DeliveryState {
  return { hasPackage: false, targetPoint: -1, targetPoints: 0, compassX: 0, compassY: 0, findMeCooldown: 0 };
}

export function createInitialWorld(): WorldState {
  const players: PlayerSlot[] = [];
  const controls: MergedControl[] = [];
  const poses: Pose[] = [];
  const deliveries: DeliveryState[] = [];
  const penaltyTicks: number[] = [];

  for (let i = 0; i < MAX_PLAYERS; i++) {
    players.push({
      index: i,
      team: Math.floor(i / 2), // default spread
      name: "",
      isBot: true,
      connected: false,
      playerKey: "",
      disconnectTick: -1,
    });
    controls.push(defaultControl(i));
    poses.push(defaultPose());
    deliveries.push(defaultDelivery());
    penaltyTicks.push(0);
  }

  const scores: TeamScore[] = [];
  for (let t = 0; t < TEAMS; t++) scores.push({ team: t, score: 0 });

  return {
    tick: 0,
    phase: "lobby",
    gameTimeTicks: 0,
    countdownTicks: 0,
    players,
    controls,
    poses,
    deliveries,
    scores,
    penaltyTicks,
    obstacles: [],
    obstacleVersion: 0,
    nextObstacleId: 1,
    quake: null,
    npcCars: [],
    travelTimes: [],
  };
}
