import { DEFAULT_BIKE_TUNING, type BikeTuning } from './bike/tuning.js';
import { DEFAULT_PHYSICS_PARAMS } from './params.js';
import type { BikeState, PhysicsParams, Surface } from './types.js';
import type { Polygon } from './collide/shapes.js';

/** Gives the ground at a point. The colliders (M3-2) replace the default. */
export type SurfaceProvider = (x: number, y: number, params: PhysicsParams) => Surface;

/** A normal road everywhere: normal grip, no speed cap. */
export const normalRoad: SurfaceProvider = (_x, _y, params) => ({ grip: params.grip, speedCap: null });

/** The rectangle of the city in M3 coordinates (x east, y north), metres. */
export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Everything the physics part keeps between two ticks. */
export interface PhysicsWorld {
  params: PhysicsParams;
  tuning: BikeTuning;
  surfaceAt: SurfaceProvider;
  /** Motorcycles by player number. */
  bikes: Map<number, BikeState>;
  /** Building footprints in M3 coordinates (from the city plan). Empty until the plan is loaded. */
  buildings: Polygon[];
  /** The city rectangle. The outer wall stands OUTER_WALL_MARGIN_M outside it. Null: no outer wall. */
  bounds: WorldBounds | null;
  /**
   * Seconds that each motorcycle has stood still with the brake held (player number -> seconds).
   * The reverse starts after `tuning.reverseWaitS`. It is kept here and not in BikeState, so it
   * is not in the output of the physics step and not in what the phone gets from the server.
   */
  stoppedS: Map<number, number>;
}

export function createWorld(
  params: Partial<PhysicsParams> = {},
  tuning: Partial<BikeTuning> = {},
): PhysicsWorld {
  return {
    params: { ...DEFAULT_PHYSICS_PARAMS, ...params },
    tuning: { ...DEFAULT_BIKE_TUNING, ...tuning },
    surfaceAt: normalRoad,
    bikes: new Map(),
    buildings: [],
    bounds: null,
    stoppedS: new Map(),
  };
}

/** Puts a standing motorcycle on the map, for example at the team store. */
export function addBike(
  world: PhysicsWorld,
  id: number,
  pose: { x: number; y: number; heading: number },
): BikeState {
  const bike: BikeState = {
    id,
    x: pose.x,
    y: pose.y,
    heading: pose.heading,
    speed: 0,
    slip: 0,
    lean: 0,
    sliding: false,
    fallen: false,
    lastSeq: -1,
  };
  world.bikes.set(id, bike);
  world.stoppedS.set(id, 0);
  return bike;
}

export function removeBike(world: PhysicsWorld, id: number): void {
  world.bikes.delete(id);
  world.stoppedS.delete(id);
}
