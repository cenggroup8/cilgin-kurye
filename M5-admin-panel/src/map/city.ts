// City grid data and coordinate conversions (M5-3).
// Derived from contracts/city_plan.json (commit f422f00).
// The city is a 6×6 grid of intersections with 60 road segments.

import { LANE_WIDTH, LANES_PER_DIR, PITCH, ROAD_HALF, WORLD_SIZE } from './grid-constants.ts';

export { LANE_WIDTH, LANES_PER_DIR, PITCH, ROAD_HALF, WORLD_SIZE };

// ── Grid constants ──────────────────────────────────────────────────

export const GRID_LINES = 6;
export const NODE_COUNT = GRID_LINES * GRID_LINES;              // 36
export const H_COUNT = GRID_LINES * (GRID_LINES - 1);           // 30 horizontal
export const V_COUNT = (GRID_LINES - 1) * GRID_LINES;           // 30 vertical
export const SEGMENT_COUNT = H_COUNT + V_COUNT;                  // 60
export const SEGMENT_LENGTH = PITCH;                             // 100 m

// ── Node ────────────────────────────────────────────────────────────

export interface CityNode {
  id: number;
  row: number;
  col: number;
  x: number;
  z: number;
}

function buildNodes(): CityNode[] {
  const out: CityNode[] = [];
  for (let r = 0; r < GRID_LINES; r++) {
    for (let c = 0; c < GRID_LINES; c++) {
      out.push({ id: r * GRID_LINES + c, row: r, col: c, x: c * PITCH, z: r * PITCH });
    }
  }
  return out;
}

export const NODES: readonly CityNode[] = buildNodes();

// ── Segment ─────────────────────────────────────────────────────────

export interface CitySegment {
  id: number;
  name: string;
  dir: 'EW' | 'NS';
  /** Start node world x. */
  ax: number;
  /** Start node world z. */
  az: number;
  /** End node world x. */
  bx: number;
  /** End node world z. */
  bz: number;
}

function buildSegments(): CitySegment[] {
  const out: CitySegment[] = [];
  // Horizontal (east–west): id = 5*row + col, col 0..4
  for (let r = 0; r < GRID_LINES; r++) {
    for (let c = 0; c < GRID_LINES - 1; c++) {
      const id = (GRID_LINES - 1) * r + c;
      out.push({
        id,
        name: `h_${r}_${c}`,
        dir: 'EW',
        ax: c * PITCH,
        az: r * PITCH,
        bx: (c + 1) * PITCH,
        bz: r * PITCH,
      });
    }
  }
  // Vertical (north–south): id = 30 + 6*row + col, row 0..4
  for (let r = 0; r < GRID_LINES - 1; r++) {
    for (let c = 0; c < GRID_LINES; c++) {
      const id = H_COUNT + GRID_LINES * r + c;
      out.push({
        id,
        name: `v_${r}_${c}`,
        dir: 'NS',
        ax: c * PITCH,
        az: r * PITCH,
        bx: c * PITCH,
        bz: (r + 1) * PITCH,
      });
    }
  }
  return out;
}

export const SEGMENTS: readonly CitySegment[] = buildSegments();

const segById = new Map(SEGMENTS.map((s) => [s.id, s]));

export function segmentById(id: number): CitySegment | undefined {
  return segById.get(id);
}

// ── Team stores ─────────────────────────────────────────────────────

export interface TeamStore {
  team: number;
  color: string;
  nodeId: number;
  x: number;
  z: number;
}

export const STORES: readonly TeamStore[] = [
  { team: 0, color: '#2196f3', nodeId: 0, x: 0, z: 0 },           // NW blue
  { team: 1, color: '#4caf50', nodeId: 5, x: 500, z: 0 },         // NE green
  { team: 2, color: '#9c27b0', nodeId: 30, x: 0, z: 500 },        // SW purple
  { team: 3, color: '#ffeb3b', nodeId: 35, x: 500, z: 500 },      // SE yellow
];

export const TEAM_COLORS: readonly string[] = STORES.map((s) => s.color);

// ── Lane offset ─────────────────────────────────────────────────────
// Lane 0 = whole road (centre line).
// 1,2 = forward direction (EW→east, NS→south), 1 near centre.
// 3,4 = reverse direction, 3 near centre.
// Positive offset = right of forward direction.

export function laneOffset(lane: number): number {
  switch (lane) {
    case 0: return 0;
    case 1: return LANE_WIDTH * 0.5;
    case 2: return LANE_WIDTH * 1.5;
    case 3: return -LANE_WIDTH * 0.5;
    case 4: return -LANE_WIDTH * 1.5;
    default: return 0;
  }
}

// ── Coordinate conversions ──────────────────────────────────────────

/**
 * Convert (segment, lane, pos) to world (x, z).
 * `pos` is 0 at node A and 1 at node B.
 */
export function segmentToWorld(segId: number, lane: number, pos: number): { x: number; z: number } {
  const seg = segById.get(segId);
  if (!seg) return { x: 0, z: 0 };

  const along = pos * SEGMENT_LENGTH;
  const perp = laneOffset(lane);

  if (seg.dir === 'EW') {
    // Forward = east (+x). Right of forward = south (+z).
    return { x: seg.ax + along, z: seg.az + perp };
  }
  // Forward = south (+z). Right of forward = west (−x).
  return { x: seg.ax - perp, z: seg.az + along };
}
