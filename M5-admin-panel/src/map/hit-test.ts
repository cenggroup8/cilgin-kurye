// Click-to-segment/lane/pos conversion (M5-3).
// All segments are axis-aligned, so the math is simple projection.

import { SEGMENTS, laneOffset, SEGMENT_LENGTH, type CitySegment } from './city.ts';
import { LANE_WIDTH, ROAD_HALF } from './grid-constants.ts';
import type { HitResult } from './types.ts';

/** Threshold around the centre line to report lane 0 (whole road). */
const LANE_0_HALF = LANE_WIDTH * 0.25;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Compute the closest-point distance, signed perpendicular offset, and clamped pos. */
function segmentDistance(seg: CitySegment, wx: number, wz: number): { dist: number; signedPerp: number; pos: number } {
  if (seg.dir === 'EW') {
    const rawT = (wx - seg.ax) / SEGMENT_LENGTH;
    const pos = clamp01(rawT);
    const signedPerp = wz - seg.az;
    // Closest-point distance: perpendicular + along-axis overshoot
    const dx = wx - (seg.ax + pos * SEGMENT_LENGTH);
    const dz = signedPerp;
    return { dist: Math.sqrt(dx * dx + dz * dz), signedPerp, pos };
  }
  const rawT = (wz - seg.az) / SEGMENT_LENGTH;
  const pos = clamp01(rawT);
  const signedPerp = seg.ax - wx;
  const dx = wx - seg.ax;
  const dz = wz - (seg.az + pos * SEGMENT_LENGTH);
  return { dist: Math.sqrt(dx * dx + dz * dz), signedPerp, pos };
}

function laneFromOffset(signedPerp: number): number {
  if (Math.abs(signedPerp) < LANE_0_HALF) return 0;
  // Find the lane whose centre is closest.
  let best = 0;
  let bestDist = Math.abs(signedPerp);
  for (let lane = 1; lane <= 4; lane++) {
    const d = Math.abs(signedPerp - laneOffset(lane));
    if (d < bestDist) {
      bestDist = d;
      best = lane;
    }
  }
  return best;
}

/**
 * Given a world point, find the nearest road segment, lane, and position.
 * Returns `null` if the point is farther than half the road width from every segment.
 */
export function hitTest(wx: number, wz: number): HitResult | null {
  let bestSeg: CitySegment | undefined;
  let bestDist = Infinity;
  let bestSigned = 0;
  let bestPos = 0;

  for (const seg of SEGMENTS) {
    const { dist, signedPerp, pos } = segmentDistance(seg, wx, wz);
    if (dist < bestDist) {
      bestDist = dist;
      bestSigned = signedPerp;
      bestPos = pos;
      bestSeg = seg;
    }
  }

  if (!bestSeg || bestDist > ROAD_HALF) return null;

  return {
    segment: bestSeg.id,
    lane: laneFromOffset(bestSigned),
    pos: Math.round(bestPos * 100) / 100,
    distance: bestDist,
    worldX: wx,
    worldZ: wz,
  };
}
