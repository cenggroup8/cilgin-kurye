/**
 * Inputs and outputs of NPC traffic (M3-4).
 *
 * In:  players, obstacles, car hits from physics (M3-2), parameters (M5 via M1).
 * Out: NPC car poses (to M1, then M4 and M5) and traffic metrics (to M1, then M5).
 */
import type { Obstacle, PlayerPose } from '../../common/types';

export type NpcState = 'driving' | 'stopped' | 'offroad';

/** One NPC car as M1 sends it on to M4 (3D city) and M5 (live map). */
export interface NpcCarPose {
  id: number;
  x: number;
  y: number;
  heading: number;
  /** m/s */
  speed: number;
  /** Edge the car is on, or null while it is inside an intersection. */
  edgeId: number | null;
  lane: number;
  length: number;
  width: number;
  /** stopped = was hit and waits; offroad = was hit hard and left the road. */
  state: NpcState;
}

/** Admin parameters for traffic (M5 -> M1 -> M3). All can change during a game. */
export interface TrafficParams {
  /** Number of normal NPC cars in the city. */
  carCount: number;
  /** Desired speed of a free NPC car, m/s. */
  maxSpeed: number;
  /** Extra slow cars on the road of each heavy traffic obstacle. */
  heavyTrafficExtraCars: number;
  /** Speed factor of these extra cars (0..1). */
  heavyTrafficSpeedFactor: number;
  /** No new car closer than this to a player, metres. */
  minSpawnDistance: number;
  /** A car that stands still this long is removed and added again elsewhere, s. */
  stuckTimeout: number;
  /** Hits at or above this speed push the car off the road, m/s. Below: it stops. */
  offroadImpactSpeed: number;
  /** How long a hit car stands still before it drives on, s. */
  hitStopTime: number;
  /** How long a car stays off the road before it is removed, s. */
  offroadTime: number;
  /** Spawns / removals per tick while the count moves to carCount. */
  maxSpawnPerTick: number;
  maxDespawnPerTick: number;
}

export const DEFAULT_TRAFFIC_PARAMS: TrafficParams = {
  carCount: 60,
  maxSpeed: 11,
  heavyTrafficExtraCars: 4,
  heavyTrafficSpeedFactor: 0.4,
  minSpawnDistance: 40,
  stuckTimeout: 20,
  offroadImpactSpeed: 7,
  hitStopTime: 2.5,
  offroadTime: 4,
  maxSpawnPerTick: 3,
  maxDespawnPerTick: 3,
};

/** A collision between a motorcycle and an NPC car, found by physics (M3-2). */
export interface CarHit {
  carId: number;
  /** Relative speed of the hit, m/s. */
  impactSpeed: number;
}

export interface TrafficInput {
  /** Tick length, s (1/30 on the server). */
  dt: number;
  players: readonly PlayerPose[];
  obstacles: readonly Obstacle[];
  /** Hits of the previous physics step. */
  carHits: readonly CarHit[];
  /** Only the parameters that changed are needed. */
  params?: Partial<TrafficParams>;
}

/** Values for the admin graphs (module document 7.3, "Traffic metrics"). */
export interface TrafficMetrics {
  /** All NPC cars now in the city, extra heavy traffic cars included. */
  carCount: number;
  /** Mean speed of the NPC cars, m/s. */
  meanSpeed: number;
  /** Cars removed because they were stuck (total since start). */
  stuckRemovals: number;
  /** Route changes of the bots (total since start), reported by M3-5. */
  botRouteChanges: number;
}

export interface TrafficOutput {
  cars: NpcCarPose[];
  metrics: TrafficMetrics;
}
