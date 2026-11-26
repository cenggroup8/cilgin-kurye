import { DEFAULT_PHYSICS_PARAMS } from './params';
import type { BikeState, PhysicsParams } from './types';

/** Everything the physics part keeps between two ticks. */
export interface PhysicsWorld {
  params: PhysicsParams;
  /** Motorcycles by player number. */
  bikes: Map<number, BikeState>;
}

export function createWorld(params: Partial<PhysicsParams> = {}): PhysicsWorld {
  return { params: { ...DEFAULT_PHYSICS_PARAMS, ...params }, bikes: new Map() };
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
