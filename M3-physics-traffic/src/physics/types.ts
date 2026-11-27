/**
 * Data of the physics part (module document 7.3 and the M3 plan, section 3.3).
 *
 * Coordinates are the same as in src/common/types.ts: metres and seconds, the
 * ground is the x / y plane, heading in radians, 0 = +x, counter clockwise is
 * positive. The change to the coordinates of contracts/ happens at the border
 * to M1, in one place, not here.
 *
 * The M1 <-> M3 physics data is not in contracts/ yet. PhysicsInput and
 * PhysicsOutput below are the M3 proposal for it.
 */
import type { Obstacle } from '../common/types.js';
import type { CarHit, NpcCarPose } from '../traffic/npc/types.js';

/** One control record. A phone and a bot send the same record. */
export interface BikeControl {
  /** 0 to 1. */
  throttle: number;
  /** 0 to 1. */
  brake: number;
  /** -1 = full left, 1 = full right. */
  steer: number;
  /** Control number given by the phone (M4-2). The predictor needs it. */
  seq: number;
}

/** The controls of one player for one tick, as M1 gives them. */
export interface BikeInput {
  player: number;
  control: BikeControl;
  /** Admin parameter players.<n>.speed_factor (0.5 to 1.5). */
  speedFactor: number;
}

/**
 * State of one motorcycle. The motorcycle model (M3-1) moves it, the collision
 * solver (M3-2) pushes it, the bots (M3-5) and the predictor read it.
 */
export interface BikeState {
  id: number;
  x: number;
  y: number;
  /** Radians, 0 = +x, counter clockwise positive. */
  heading: number;
  /** Forward speed in m/s. Never negative: there is no reverse. */
  speed: number;
  /** Side speed in m/s while the motorcycle slides out of a turn, positive to the rider's left; 0 otherwise. */
  slip: number;
  /** Lean angle for drawing (M4), radians, positive = leaning to the right. */
  lean: number;
  sliding: boolean;
  /** A fallen motorcycle does not move and is not solid. */
  fallen: boolean;
  /** Number of the last control used on this motorcycle. */
  lastSeq: number;
}

/** The ground under a motorcycle, given by the colliders (M3-2). */
export interface Surface {
  /** The grip to use here: physics.grip on a normal road, lower on a puddle or in the earthquake area. */
  grip: number;
  /** Speed limit of an accident slow zone, m/s, or null when there is none. */
  speedCap: number | null;
}

/** The earthquake area that M1 sends while an earthquake is active. */
export interface QuakeArea {
  x: number;
  y: number;
  radius: number;
  /** 0 to 10. */
  strength: number;
}

export type HitKind = 'building' | 'wall' | 'barrier' | 'npc' | 'bike';

export interface CollisionEvent {
  kind: 'collision';
  player: number;
  with: HitKind;
  /** Id of the NPC car or of the other motorcycle, otherwise null. */
  other: number | null;
  /** Speed along the contact normal, m/s. */
  impactSpeed: number;
}

export interface FallEvent {
  kind: 'fall';
  player: number;
  cause: HitKind;
  impactSpeed: number;
}

export type PhysicsEvent = CollisionEvent | FallEvent;

/** Everything M1 gives to the physics part in one tick. */
export interface PhysicsInput {
  tick: number;
  /** Tick length in seconds (1/30 on the server). */
  dt: number;
  /** Controls of all players, humans and bots together. */
  bikes: readonly BikeInput[];
  obstacles: readonly Obstacle[];
  /** NPC cars of this tick, from the traffic part. */
  npcCars: readonly NpcCarPose[];
  quake: QuakeArea | null;
  /**
   * Players that M1 drops in an earthquake. M1 already knows about these falls,
   * so no fall event comes back for them and no penalty is counted twice.
   */
  fall: readonly number[];
  /** Players whose penalty is over; they stand up and can ride again. */
  standUp: readonly number[];
}

/** Everything the physics part gives back to M1 after one tick. */
export interface PhysicsOutput {
  tick: number;
  bikes: BikeState[];
  events: PhysicsEvent[];
  /** Car hits for the traffic part in the next tick (M3-4). */
  carHits: CarHit[];
}

/**
 * Parameters of the physics part. The admin names are in params.ts; the start
 * values are the same as in the M1 parameter registry (M1-5).
 */
export interface PhysicsParams {
  /** physics.top_speed_mps */
  topSpeed: number;
  /** physics.grip */
  grip: number;
  /** physics.grip_puddle */
  gripPuddle: number;
  /** quake.grip */
  gripQuake: number;
  /** physics.fall_speed_mps */
  fallSpeed: number;
}
