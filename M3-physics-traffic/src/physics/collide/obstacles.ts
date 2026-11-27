/**
 * Solid shapes of the obstacle list (M3-2, step 4). Everything here is TAHMİN where
 * the module document and contracts/ do not say it (see constants.ts).
 *
 * - road_work: a barrier across the WHOLE road, both directions (also when a lane is given:
 *   the NPC traffic closes the whole road for road work too, npcTraffic.ts applyObstacles).
 * - accident: solid in the lane it names, a block of one lane wide and one car long; without a
 *   lane the same barrier as road work. (The slow zone around it is for the next step.)
 * - heavy_traffic and puddle are not solid: no shape.
 *
 * The shapes are made new from the list in every call, so an obstacle that M1 removes from the
 * list is gone in the next tick. The position is found like the NPC traffic does: the edge frame
 * and the distance `s` along the edge (the middle of the road when `s` is missing).
 */
import type { Obstacle } from '../../common/types.js';
import { edgeFrame, lanePoint } from '../../traffic/graph/laneGeometry.js';
import type { RoadGraph } from '../../traffic/graph/types.js';
import type { HitKind } from '../types.js';
import {
  ACCIDENT_LANE_BLOCK_LENGTH_M,
  ACCIDENT_LANE_BLOCK_WIDTH_M,
  BARRIER_THICKNESS_M,
  ROAD_BLOCK_WIDTH_M,
} from './constants.js';
import type { Obb } from './shapes.js';

export interface ObstacleShape {
  /** Id of the obstacle in the list. */
  id: number;
  /** 'barrier' for road work, 'obstacle' for an accident (the `with` of the collision event). */
  hit: HitKind;
  box: Obb;
}

/**
 * The solid shapes of the obstacles, in the order of the list. An obstacle that does not fit the
 * graph (unknown road, an edge of another road, a lane that does not exist, a distance that is
 * not a number or outside the road) gives no shape. M1 has checked its list, so this is only a
 * safety net, and the physics step must not throw.
 */
export function obstacleShapes(obstacles: readonly Obstacle[], graph: RoadGraph | null): ObstacleShape[] {
  if (!graph) return [];
  const shapes: ObstacleShape[] = [];
  for (const o of obstacles) {
    if (o.type !== 'roadWork' && o.type !== 'accident') continue;
    const road = graph.roads[o.roadId];
    if (!road) continue;
    const ref =
      o.edgeId !== undefined
        ? graph.edges[o.edgeId]
        : graph.edges.find((e) => e.roadId === o.roadId && e.from === road.a);
    if (!ref || ref.roadId !== o.roadId) continue;

    const frame = edgeFrame(graph, ref);
    const s = o.s ?? frame.length / 2;
    if (!Number.isFinite(s) || s < 0 || s > frame.length) continue;

    const wholeRoad = o.type === 'roadWork' || o.lane === undefined;
    if (wholeRoad) {
      // Across the road, centred on the centre line.
      shapes.push({
        id: o.id,
        hit: o.type === 'roadWork' ? 'barrier' : 'obstacle',
        box: {
          x: frame.start.x + frame.dir.x * s,
          y: frame.start.y + frame.dir.y * s,
          length: BARRIER_THICKNESS_M,
          width: ROAD_BLOCK_WIDTH_M,
          heading: frame.heading,
        },
      });
      continue;
    }
    if (!Number.isInteger(o.lane) || o.lane! < 0 || o.lane! >= frame.lanes) continue;
    const centre = lanePoint(graph, frame, o.lane!, s);
    shapes.push({
      id: o.id,
      hit: 'obstacle',
      box: {
        x: centre.x,
        y: centre.y,
        length: ACCIDENT_LANE_BLOCK_LENGTH_M,
        width: ACCIDENT_LANE_BLOCK_WIDTH_M,
        heading: frame.heading,
      },
    });
  }
  return shapes;
}
