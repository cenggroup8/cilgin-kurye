import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hitTest } from '../../src/map/hit-test.ts';
import { segmentToWorld, SEGMENTS, SEGMENT_LENGTH, laneOffset } from '../../src/map/city.ts';
import { ROAD_HALF, LANE_WIDTH } from '../../src/map/grid-constants.ts';

describe('hitTest', () => {
  it('centre of horizontal segment h_0_0 returns segment 0, lane 0, pos ≈ 0.5', () => {
    const result = hitTest(50, 0);
    assert.ok(result);
    assert.equal(result.segment, 0);
    assert.equal(result.lane, 0);
    assert.equal(result.pos, 0.5);
  });

  it('centre of vertical segment v_0_0 returns segment 30, lane 0, pos ≈ 0.5', () => {
    const result = hitTest(0, 50);
    assert.ok(result);
    assert.equal(result.segment, 30);
    assert.equal(result.lane, 0);
    assert.equal(result.pos, 0.5);
  });

  it('click south of h_0_0 centre line picks forward outer lane (lane 2)', () => {
    // Forward = east, right = south. Lane 2 centre at z = 0 + 1.5 * 3.5 = 5.25.
    const result = hitTest(50, 5.25);
    assert.ok(result);
    assert.equal(result.segment, 0);
    assert.equal(result.lane, 2);
  });

  it('click north of h_0_0 centre line picks reverse outer lane (lane 4)', () => {
    // Lane 4 centre at z = 0 - 1.5 * 3.5 = -5.25.
    const result = hitTest(50, -5.25);
    assert.ok(result);
    assert.equal(result.segment, 0);
    assert.equal(result.lane, 4);
  });

  it('click far from any road returns null', () => {
    // Centre of a city block: (50, 50) is 50 m away from both h_0_0 (z=0) and v_0_0 (x=0).
    const result = hitTest(50, 50);
    assert.equal(result, null);
  });

  it('click at node n_0_0 (intersection) returns a valid segment', () => {
    const result = hitTest(0, 0);
    assert.ok(result);
    // Should be one of h_0_0 (id 0) or v_0_0 (id 30).
    assert.ok(result.segment === 0 || result.segment === 30);
  });

  it('pos 0 at start, pos 1 at end of segment', () => {
    // Start of h_0_0: x=0
    const start = hitTest(0, 0);
    assert.ok(start);
    assert.equal(start.pos, 0);

    // End of h_0_0: x=100
    const end = hitTest(100, 0);
    assert.ok(end);
    // At x=100, it's the boundary of h_0_0 (pos=1) or h_0_1 (pos=0).
    assert.ok(end.pos === 1 || end.pos === 0);
  });

  it('roundtrip: segmentToWorld → hitTest returns same segment and lane', () => {
    for (const seg of SEGMENTS) {
      for (const lane of [0, 1, 2, 3, 4]) {
        const pos = 0.5;
        const { x, z } = segmentToWorld(seg.id, lane, pos);
        const result = hitTest(x, z);
        assert.ok(result, `hitTest returned null for segment ${seg.id}, lane ${lane}`);
        assert.equal(result.segment, seg.id, `segment mismatch for ${seg.name} lane ${lane}`);
        if (lane !== 0) {
          assert.equal(result.lane, lane, `lane mismatch for ${seg.name} lane ${lane}`);
        }
      }
    }
  });

  it('distance field is within road half-width for valid hits', () => {
    const result = hitTest(50, 3);
    assert.ok(result);
    assert.ok(result.distance <= ROAD_HALF);
  });

  it('h_2_3 midpoint returns segment id 13', () => {
    // h_2_3: row=2, col=3 → id = 5*2 + 3 = 13
    // Centre at x = 3*100 + 50 = 350, z = 2*100 = 200
    const result = hitTest(350, 200);
    assert.ok(result);
    assert.equal(result.segment, 13);
    assert.equal(result.pos, 0.5);
  });

  it('v_3_2 midpoint returns segment id 50', () => {
    // v_3_2: id = 30 + 6*3 + 2 = 50
    // Centre at x = 2*100 = 200, z = 3*100 + 50 = 350
    const result = hitTest(200, 350);
    assert.ok(result);
    assert.equal(result.segment, 50);
    assert.equal(result.pos, 0.5);
  });
});
