import { describe, expect, it } from 'vitest';
import {
  ACCIDENT_LANE_BLOCK_WIDTH_M,
  BARRIER_THICKNESS_M,
  BIKE_RADIUS_M,
  ROAD_BLOCK_WIDTH_M,
} from '../../../src/physics/collide/constants.js';
import planJson from '../../fakes/city_plan.json' with { type: 'json' };

describe('tunnel guard for the collision constants', () => {
  it('the worst-case move in one substep is below radius + thickness / 2', () => {
    const worstSpeed = 30 * 1.5; // highest top speed (m/s) x highest speed factor
    const substep = 1 / 60; // 30 ticks per second, 2 substeps per tick
    const move = worstSpeed * substep;
    const limit = BIKE_RADIUS_M + BARRIER_THICKNESS_M / 2;
    expect(
      move,
      `A bike at ${worstSpeed} m/s moves ${move} m per substep, but radius + thickness / 2 is only ${limit} m. ` +
        'It could pass through a barrier. Raise BARRIER_THICKNESS_M or BIKE_RADIUS_M, or use more substeps.',
    ).toBeLessThan(limit);
  });
});

describe('the obstacle shapes cover the road of the city plan', () => {
  const roadHalf = planJson.grid.lanes_per_direction * planJson.grid.lane_width_m; // 7 m from the centre line
  const SIDEWALK_M = 3; // contracts/README.md, Buildings: a building stays 10 m from the centre line

  it('a barrier across the road reaches the buildings, so a motorcycle cannot ride past on the sidewalk', () => {
    expect(
      ROAD_BLOCK_WIDTH_M,
      `The barrier is ${ROAD_BLOCK_WIDTH_M} m wide, but the road (${2 * roadHalf} m) and its two sidewalks of ${SIDEWALK_M} m are ` +
        `${2 * (roadHalf + SIDEWALK_M)} m. A motorcycle could pass on a sidewalk. Raise ROAD_BLOCK_WIDTH_M.`,
    ).toBeGreaterThanOrEqual(2 * (roadHalf + SIDEWALK_M));
  });

  it('an accident in one lane is as wide as the lane', () => {
    expect(ACCIDENT_LANE_BLOCK_WIDTH_M).toBeGreaterThanOrEqual(planJson.grid.lane_width_m);
  });
});
