// Tick girdileri ve M3 arayüz tipleri (M1-1, plan 3.3).

import type { AdminCommand } from "../admin/admin.js";

// ── M2'den gelen girdiler ──────────────────────────────────────────

export interface ControlInput {
  player: number;
  seq: number;
  throttle: number; // 0–1
  brake: number;    // 0–1
  steer: number;    // −1 – 1
}

export interface FindMeInput {
  player: number;
}

export interface JoinInput {
  playerKey: string;
  /** The number M2-1 gave this phone in its welcome (0–7). M1-2 uses it as the player number. */
  playerNo: number;
  name: string;
  team: number; // 0–3
}

export interface DisconnectInput {
  playerKey: string;
}

export interface ReconnectInput {
  playerKey: string;
}

export interface BoardEvent {
  source: "hand" | "motors";
  magnitude: number; // 0–10
  zone: number;      // 0–8
  confidence: number; // 0–1
}

/** Everything M2 collected between two ticks. */
export interface TickInput {
  controls: ControlInput[];
  findMe: FindMeInput[];
  joins: JoinInput[];
  disconnects: DisconnectInput[];
  reconnects: ReconnectInput[];
  adminCommands: AdminCommand[];
  boardEvents: BoardEvent[];
}

export function emptyTickInput(): TickInput {
  return {
    controls: [],
    findMe: [],
    joins: [],
    disconnects: [],
    reconnects: [],
    adminCommands: [],
    boardEvents: [],
  };
}

// ── M3 arayüzü ────────────────────────────────────────────────────

export interface Pose {
  x: number;
  z: number;
  heading: number;  // derece, kuzeyden saat yönü (0 = kuzey, 90 = doğu)
  speed: number;    // m/s (negatif olabilir: geri)
  lean: number;
  sliding: boolean;
  fallen: boolean;
}

export interface CollisionEvent {
  player: number;
  withWhat: "building" | "wall" | "barrier" | "npc" | "bike";
  otherPlayer?: number;
  impactSpeed: number;
}

export interface FallEvent {
  player: number;
  cause: "collision" | "quake" | "puddle" | "obstacle";
  impactSpeed: number;
}

export interface NpcCar {
  id: number;
  x: number;
  z: number;
  heading: number; // derece, kuzeyden saat yönü
  speed: number;
  lane: number;
  size: number;
}

export interface TrafficOutput {
  npcCars: NpcCar[];
  botControls: ControlInput[];
  travelTimes: number[][]; // [storeIndex][pointIndex] → seconds
  trafficMetrics: { npcCount: number; meanNpcSpeed: number; botRouteChanges: number };
}

export interface PhysicsOutput {
  poses: Pose[];         // indexed by player slot
  collisions: CollisionEvent[];
  falls: FallEvent[];
}

/** What M1 sends to M3 traffic step. */
export interface TrafficRequest {
  tick: number;
  obstacles: ObstacleEntry[];
  players: PlayerSlot[];
}

/** What M1 sends to M3 physics step. */
export interface PhysicsRequest {
  controls: MergedControl[];
  obstacles: ObstacleEntry[];
  quake: QuakeState | null;
  standUp: number[]; // player slots to stand up
  falls: number[];   // player slots to force-fall (earthquake etc.)
}

// ── Ortak tipler (loop ve state arasında paylaşılır) ───────────────

export type Phase = "lobby" | "countdown" | "playing" | "paused" | "ended";

export interface PlayerSlot {
  index: number;    // 0–7
  team: number;     // 0–3
  name: string;
  isBot: boolean;
  connected: boolean;
  playerKey: string;
  disconnectTick: number; // -1 if connected
}

export interface MergedControl {
  player: number;
  seq: number;
  throttle: number;
  brake: number;
  steer: number;
}

export interface ObstacleEntry {
  id: number;
  type: "heavy_traffic" | "road_work" | "accident" | "puddle";
  segment: number;
  lane: number;
  pos: number;
  endTick: number;
  source: "random" | "admin" | "quake";
}

export interface QuakeState {
  active: boolean;
  centerX: number;
  centerZ: number;
  radius: number;
  magnitude: number;
  startTick: number;
  endTick: number;
}

export interface DeliveryState {
  hasPackage: boolean;
  targetPoint: number; // -1 if none
  targetPoints: number;
  compassTarget: { x: number; z: number };
  findMeCooldown: number; // ticks remaining
}

export interface TeamScore {
  team: number;
  score: number;
}

/** M1 → M2: join sonucu, tick bittikten sonra gönderilir. */
export interface JoinAnswer {
  playerKey: string;
  ok: boolean;
  team?: number;
}
