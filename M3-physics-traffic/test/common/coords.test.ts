import { describe, expect, it } from 'vitest';
import {
  fromContractHeading,
  fromContractPoint,
  toContractHeading,
  toContractPoint,
} from '../../src/common/coords';

describe('coordinates at the border of M3', () => {
  it('turns south (z) into minus y and back', () => {
    expect(fromContractPoint(100, 200)).toEqual({ x: 100, y: -200 });
    expect(toContractPoint({ x: 100, y: -200 })).toEqual({ x: 100, z: 200 });
  });

  it('turns compass headings into maths angles', () => {
    expect(fromContractHeading(90)).toBeCloseTo(0, 12); // east
    expect(fromContractHeading(0)).toBeCloseTo(Math.PI / 2, 12); // north
    expect(fromContractHeading(180)).toBeCloseTo(-Math.PI / 2, 12); // south
    expect(Math.abs(fromContractHeading(270))).toBeCloseTo(Math.PI, 12); // west
  });

  it('gives back the same heading after a round trip', () => {
    for (const deg of [0, 1, 45, 90, 135, 180, 225, 270, 315, 359.5]) {
      expect(toContractHeading(fromContractHeading(deg))).toBeCloseTo(deg, 9);
    }
  });

  it('keeps the turn direction: a right turn in the game is clockwise on the map', () => {
    // M3: a right turn makes the heading smaller. Contract: clockwise is a larger heading.
    const before = fromContractHeading(90);
    const after = before - 0.1;
    expect(toContractHeading(after)).toBeGreaterThan(90);
  });
});
