/**
 * Plain data types that M1 gives to M3 every tick ("Game data" in the module
 * document, section 7.3). They are shared by the physics part, NPC traffic and
 * bots.
 *
 * Coordinates inside M3:
 * - Units are metres and seconds.
 * - x to the east, y to the north (the ground plane).
 * - heading in radians, 0 = east, counter clockwise is positive.
 * - Traffic drives on the right.
 * contracts/ uses x east, z south and degrees clockwise from north. The change
 * happens in one place, src/common/coords.ts.
 *
 * M1 sends obstacles in the contracts form (type 'heavy_traffic', segment,
 * lane 0-4, pos 0-1). src/traffic/npc/contract.ts turns them into the Obstacle
 * below, which uses the edges and lanes of the road graph.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleType = 'heavyTraffic' | 'roadWork' | 'accident' | 'puddle';

export interface Obstacle {
  id: number;
  type: ObstacleType;
  /** Road (undirected) the obstacle is on: the contracts segment id. */
  roadId: number;
  /**
   * Directed edge the obstacle is on. `lane` and `s` are measured on this edge.
   * Missing: the forward edge of the road (from road.a to road.b).
   */
  edgeId?: number;
  /** Lane index on that edge, 0 = the lane next to the centre line. Missing = the whole road. */
  lane?: number;
  /** Distance from the start stop line of that edge (metres). Missing = middle of the road. */
  s?: number;
}

export interface PlayerPose {
  id: number;
  x: number;
  y: number;
  heading: number;
  /** m/s */
  speed: number;
  /** A fallen motorcycle is not solid (module document 7.5). */
  fallen: boolean;
}
