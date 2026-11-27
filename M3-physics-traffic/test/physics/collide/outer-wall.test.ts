import { describe, expect, it } from 'vitest';
import { OUTER_WALL_MARGIN_M } from '../../../src/physics/collide/constants.js';
import planJson from '../../fakes/city_plan.json' with { type: 'json' };

describe('outer wall distance', () => {
  it('the inner face stands further out than the road edge, so the roads are all inside', () => {
    const roadEdge = planJson.grid.lanes_per_direction * planJson.grid.lane_width_m; // from the outermost centre line
    expect(
      OUTER_WALL_MARGIN_M,
      `The inner face of the outer wall is ${OUTER_WALL_MARGIN_M} m outside the city rectangle, but the road edge is ` +
        `${roadEdge} m outside it (${planJson.grid.lanes_per_direction} lanes x ${planJson.grid.lane_width_m} m). ` +
        'The wall would stand on the road. Raise OUTER_WALL_MARGIN_M.',
    ).toBeGreaterThan(roadEdge);
  });

  it('the outermost road centre lines are on the rectangle that the world bounds use', () => {
    const xs = planJson.nodes.map((n) => n.x);
    const zs = planJson.nodes.map((n) => n.z);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([0, planJson.world.size_m, 0, planJson.world.size_m]);
  });
});
