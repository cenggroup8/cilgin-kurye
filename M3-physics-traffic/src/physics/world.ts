import { DEFAULT_BIKE_TUNING, type BikeTuning } from './bike/tuning.js';
import { DEFAULT_PHYSICS_PARAMS } from './params.js';
import type { BikeState, PhysicsParams, Surface } from './types.js';

/** Gives the ground at a point. The colliders (M3-2) replace the default. */
export type SurfaceProvider = (x: number, y: number, params: PhysicsParams) => Surface;

/** A normal road everywhere: normal grip, no speed cap. */
export const normalRoad: SurfaceProvider = (_x, _y, params) => ({ grip: params.grip, speedCap: null });

/** Everything the physics part keeps between two ticks. */
export interface PhysicsWorld {
  params: PhysicsParams;
  tuning: BikeTuning;
  surfaceAt: SurfaceProvider;
  /** Motorcycles by player number. */
  bikes: Map<number, BikeState>;
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
  return bike;
}

export function removeBike(world: PhysicsWorld, id: number): void {
  world.bikes.delete(id);
}
