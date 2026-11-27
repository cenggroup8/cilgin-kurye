/**
 * Where the obstacles of the list stand, and their solid shapes (M3-2, step 4 and 5).
 * Everything here is TAHMİN where the module document and contracts/ do not say it
 * (see constants.ts).
 *
 * `obstacleSites` is the one place that finds the position (edge frame, distance `s`,
 * lane). The solid shapes (road work, accident) and the ground effects (puddle, slow zone
 * of an accident, see surface.ts) both come from it, so their positions cannot differ.
 *
 * - road_work: a barrier across the WHOLE road, both directions (also when a lane is given:
 *   the NPC traffic closes the whole road for road work too, npcTraffic.ts applyObstacles).
 * - accident: solid in the lane it names, a block of one lane wide and one car long; without a
 *   lane the same barrier as road work. Around it there is a slow zone (surface.ts).
 * - puddle: not solid; makes the ground slippery (surface.ts).
 * - heavy_traffic: no site (the traffic part adds slow cars, the physics part does nothing).
 *
 * The sites are made new from the list in every call, so an obstacle that M1 removes from the
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

export interface ObstacleSite {
  /** Id of the obstacle in the list. */
  id: number;
  type: 'roadWork' | 'accident' | 'puddle';
  /** True: across the whole road (road work always; accident and puddle when they have no lane). */
  wholeRoad: boolean;
  /** Centre: on the centre line (whole road) or in the middle of the lane. */
  x: number;
  y: number;
  /** Direction of the edge the obstacle is measured on, radians. */
  heading: number;
}

/**
 * The sites of road work, accident and puddle, in the order of the list. An obstacle that does not
 * fit the graph (unknown road, an edge of another road, a lane that does not exist, a distance that
 * is not a number or outside the road) gives no site. M1 has checked its list, so this is only a
 * safety net, and the physics step must not throw. No graph: no sites.
 */
export function obstacleSites(obstacles: readonly Obstacle[], graph: RoadGraph | null): ObstacleSite[] {
  if (!graph) return [];
  const sites: ObstacleSite[] = [];
  for (const o of obstacles) {
    if (o.type !== 'roadWork' && o.type !== 'accident' && o.type !== 'puddle') continue;
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
      sites.push({
        id: o.id,
        type: o.type,
        wholeRoad: true,
        x: frame.start.x + frame.dir.x * s,
        y: frame.start.y + frame.dir.y * s,
        heading: frame.heading,
      });
      continue;
    }
    if (!Number.isInteger(o.lane) || o.lane! < 0 || o.lane! >= frame.lanes) continue;
    const centre = lanePoint(graph, frame, o.lane!, s);
    sites.push({ id: o.id, type: o.type, wholeRoad: false, x: centre.x, y: centre.y, heading: frame.heading });
  }
  return sites;
}

export interface ObstacleShape {
  /** Id of the obstacle in the list. */
  id: number;
  /** 'barrier' for road work, 'obstacle' for an accident (the `with` of the collision event). */
  hit: HitKind;
  box: Obb;
}

/** The solid shapes of the sites (road work and accident), in the order of the list. */
export function obstacleShapes(obstacles: readonly Obstacle[], graph: RoadGraph | null): ObstacleShape[] {
  const shapes: ObstacleShape[] = [];
  for (const site of obstacleSites(obstacles, graph)) {
    if (site.type === 'puddle') continue; // not solid
    const hit: HitKind = site.type === 'roadWork' ? 'barrier' : 'obstacle';
    const box: Obb = site.wholeRoad
      ? { x: site.x, y: site.y, length: BARRIER_THICKNESS_M, width: ROAD_BLOCK_WIDTH_M, heading: site.heading }
      : { x: site.x, y: site.y, length: ACCIDENT_LANE_BLOCK_LENGTH_M, width: ACCIDENT_LANE_BLOCK_WIDTH_M, heading: site.heading };
    shapes.push({ id: site.id, hit, box });
  }
  return shapes;
}
