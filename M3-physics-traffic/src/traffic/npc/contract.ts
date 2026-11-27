/**
 * The border of NPC traffic to M1, in the language of contracts/ (PR #62):
 *
 * - Obstacles come as the M1-4 list gives them (PR #67): type 'heavy_traffic',
 *   'road_work', 'accident' or 'puddle'; segment id; lane 0-4; pos 0-1 along
 *   the segment from node a to node b.
 * - Lanes (contracts/README.md): 0 = the whole road; 1, 2 drive in the direction
 *   of the segment; 3, 4 the other way; 1 and 3 are next to the centre line.
 *   Inside M3 a lane is (directed edge, index from the centre line), so
 *   lane 1 -> forward edge 0, 2 -> forward 1, 3 -> reverse 0, 4 -> reverse 1.
 * - Cars go out in contracts coordinates (x east, z south, heading in degrees
 *   clockwise from north), with segment and lane in the same numbering.
 *
 * Bad input throws RangeError: M1 has checked it already, so it is a bug.
 */
import { toContractHeading, toContractPoint } from '../../common/coords.js';
import type { Obstacle, ObstacleType } from '../../common/types.js';
import type { RoadGraph } from '../graph/types.js';
import type { NpcCarPose, NpcState } from './types.js';

export type ContractObstacleType = 'heavy_traffic' | 'road_work' | 'accident' | 'puddle';

/** The fields of an M1-4 obstacle that traffic needs (extra fields are allowed). */
export interface ContractObstacle {
  id: number;
  type: ContractObstacleType;
  segment: number;
  /** 0 = whole road, 1-4 = one lane. */
  lane: number;
  /** 0-1 along the segment, from node a to node b. */
  pos: number;
}

export interface ContractNpcCar {
  id: number;
  x: number;
  z: number;
  /** Degrees, clockwise from north, 0-360. */
  heading: number;
  /** m/s */
  speed: number;
  /** Segment the car drives on, or null inside an intersection or off the road. */
  segment: number | null;
  /** 1-4 as in contracts/, or null when segment is null. */
  lane: number | null;
  length: number;
  width: number;
  state: NpcState;
}

const TYPES: Record<ContractObstacleType, ObstacleType> = {
  heavy_traffic: 'heavyTraffic',
  road_work: 'roadWork',
  accident: 'accident',
  puddle: 'puddle',
};

/** M1 obstacle -> M3 obstacle (edge, lane from the centre line, metres). */
export function fromContractObstacle(o: ContractObstacle, g: RoadGraph): Obstacle {
  const type = TYPES[o.type];
  if (!type) throw new RangeError(`Obstacle ${o.id}: unknown type ${o.type}`);
  const road = g.roads[o.segment];
  if (!Number.isInteger(o.segment) || !road) throw new RangeError(`Obstacle ${o.id}: unknown segment ${o.segment}`);
  const n = road.lanesPerDirection;
  if (!Number.isInteger(o.lane) || o.lane < 0 || o.lane > 2 * n) {
    throw new RangeError(`Obstacle ${o.id}: segment ${o.segment} has no lane ${o.lane}`);
  }
  if (!Number.isFinite(o.pos) || o.pos < 0 || o.pos > 1) throw new RangeError(`Obstacle ${o.id}: bad pos ${o.pos}`);

  const forward = g.edges.find((e) => e.roadId === o.segment && e.from === road.a)!;
  const reverse = g.edges[forward.reverseId];
  const a = g.nodes[road.a];
  const b = g.nodes[road.b];
  const full = Math.hypot(b.x - a.x, b.y - a.y);
  const h = g.intersectionHalfSize;
  const along = (fromA: number) => Math.min(Math.max(fromA * full - h, 0), full - 2 * h);

  if (o.lane === 0) return { id: o.id, type, roadId: o.segment, edgeId: forward.id, s: along(o.pos) };
  if (o.lane <= n) return { id: o.id, type, roadId: o.segment, edgeId: forward.id, lane: o.lane - 1, s: along(o.pos) };
  return { id: o.id, type, roadId: o.segment, edgeId: reverse.id, lane: o.lane - n - 1, s: along(1 - o.pos) };
}

export function fromContractObstacles(list: readonly ContractObstacle[], g: RoadGraph): Obstacle[] {
  return list.map((o) => fromContractObstacle(o, g));
}

/** M3 car -> contracts car (coordinates, segment and lane numbering of contracts/). */
export function toContractCar(car: NpcCarPose, g: RoadGraph): ContractNpcCar {
  const p = toContractPoint(car);
  let segment: number | null = null;
  let lane: number | null = null;
  if (car.edgeId !== null) {
    const e = g.edges[car.edgeId];
    const road = g.roads[e.roadId];
    segment = e.roadId;
    lane = e.from === road.a ? car.lane + 1 : road.lanesPerDirection + car.lane + 1;
  }
  return {
    id: car.id,
    x: p.x,
    z: p.z,
    heading: toContractHeading(car.heading),
    speed: car.speed,
    segment,
    lane,
    length: car.length,
    width: car.width,
    state: car.state,
  };
}
