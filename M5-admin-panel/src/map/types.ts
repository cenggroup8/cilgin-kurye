// Shared types for the M5-3 map manager.

export const OBSTACLE_TYPES = ['heavy_traffic', 'road_work', 'accident', 'puddle'] as const;
export type ObstacleType = (typeof OBSTACLE_TYPES)[number];

export const MAX_LANE = 4;

export interface HitResult {
  segment: number;
  lane: number;
  /** 0 at node A, 1 at node B. */
  pos: number;
  /** Perpendicular distance from click to segment centre line (metres). */
  distance: number;
  worldX: number;
  worldZ: number;
}

export type ToolType =
  | { kind: 'brush'; obstacle: ObstacleType }
  | { kind: 'eraser' }
  | { kind: 'close_road' }
  | { kind: 'obstacle_ahead'; obstacle: ObstacleType }
  | { kind: 'none' };
