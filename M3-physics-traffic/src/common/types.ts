/**
 * Plain data types that M1 gives to M3 every tick ("Game data" in the module
 * document, section 7.3). They are shared by the physics part, NPC traffic and
 * bots. Proposal by M3-4; when the shared contracts/ folder exists, these types
 * should move there or be generated from it.
 *
 * World coordinates (proposal, used until the city plan file exists):
 * - Units are metres and seconds.
 * - The ground is the x / y plane. M4 can map y to the 3D z axis.
 * - heading is in radians, 0 = +x, counter clockwise is positive.
 * - Traffic drives on the right.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleType = 'heavyTraffic' | 'roadWork' | 'accident' | 'puddle';

export interface Obstacle {
  id: number;
  type: ObstacleType;
  /** Road (undirected) the obstacle is on. */
  roadId: number;
  /** Directed edge, if the obstacle is only on one side of the road (accident, puddle). */
  edgeId?: number;
  /** Lane index on that edge, 0 = the lane next to the centre line. */
  lane?: number;
  /** Distance from the start of the edge (metres). Missing = middle of the road. */
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
