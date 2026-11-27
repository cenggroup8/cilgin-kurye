import { describe, expect, it } from 'vitest';
import { BARRIER_THICKNESS_M, BIKE_RADIUS_M } from '../../../src/physics/collide/constants.js';

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
