import { describe, expect, it } from 'vitest';
import { judgeImpact, relativeNormalSpeed } from '../../../src/physics/collide/fall-judge.js';
import { DEFAULT_PHYSICS_PARAMS } from '../../../src/physics/index.js';

const FALL = DEFAULT_PHYSICS_PARAMS.fallSpeed; // 6 m/s

describe('judgeImpact', () => {
  it('a hit below the fall speed is a bump', () => {
    expect(judgeImpact(0, FALL)).toBe('bump');
    expect(judgeImpact(3, FALL)).toBe('bump');
    expect(judgeImpact(5.999, FALL)).toBe('bump');
  });

  it('a hit exactly at the fall speed is a bump', () => {
    expect(judgeImpact(FALL, FALL)).toBe('bump');
    expect(judgeImpact(12.5, 12.5)).toBe('bump');
  });

  it('a hit above the fall speed is a fall', () => {
    expect(judgeImpact(6.001, FALL)).toBe('fall');
    expect(judgeImpact(20, FALL)).toBe('fall');
    expect(judgeImpact(Number.MIN_VALUE, 0)).toBe('fall');
  });

  it('follows the limit that the admin sets', () => {
    expect(judgeImpact(10, 12)).toBe('bump');
    expect(judgeImpact(10, 8)).toBe('fall');
    expect(judgeImpact(1, 1)).toBe('bump');
  });

  it('a bad number is a bump, so it never makes a motorcycle fall', () => {
    expect(judgeImpact(Number.NaN, FALL)).toBe('bump');
    expect(judgeImpact(-1, FALL)).toBe('bump');
    expect(judgeImpact(Infinity, FALL)).toBe('bump');
    expect(judgeImpact(10, Number.NaN)).toBe('bump');
    expect(judgeImpact(10, Infinity)).toBe('bump');
    expect(judgeImpact(undefined as unknown as number, FALL)).toBe('bump');
  });
});

describe('relativeNormalSpeed', () => {
  // The normal points from B to A: A is on the east of B.
  const east = { x: 1, y: 0 };

  it('two bikes driving at each other add their speeds', () => {
    expect(relativeNormalSpeed({ vx: -3, vy: 0 }, { vx: 4, vy: 0 }, east)).toBeCloseTo(7, 12);
  });

  it('a bike that hits a standing one', () => {
    expect(relativeNormalSpeed({ vx: -5, vy: 0 }, { vx: 0, vy: 0 }, east)).toBeCloseTo(5, 12);
    expect(relativeNormalSpeed({ vx: 0, vy: 0 }, { vx: 5, vy: 0 }, east)).toBeCloseTo(5, 12);
  });

  it('is 0 when moving apart, side by side or at the same velocity', () => {
    expect(relativeNormalSpeed({ vx: 3, vy: 0 }, { vx: -4, vy: 0 }, east)).toBe(0);
    expect(relativeNormalSpeed({ vx: 0, vy: 9 }, { vx: 0, vy: -9 }, east)).toBeCloseTo(0, 12);
    expect(relativeNormalSpeed({ vx: 5, vy: 5 }, { vx: 5, vy: 5 }, east)).toBe(0);
  });

  it('only the part along the normal counts', () => {
    const r = Math.SQRT1_2;
    expect(relativeNormalSpeed({ vx: -6, vy: 0 }, { vx: 0, vy: 0 }, { x: r, y: r })).toBeCloseTo(6 * r, 12);
  });

  it('is 0 for numbers that are not finite', () => {
    expect(relativeNormalSpeed({ vx: Number.NaN, vy: 0 }, { vx: 0, vy: 0 }, east)).toBe(0);
    expect(relativeNormalSpeed({ vx: -5, vy: 0 }, { vx: 0, vy: Infinity }, east)).toBe(0);
    expect(relativeNormalSpeed({ vx: -5, vy: 0 }, { vx: 0, vy: 0 }, { x: Number.NaN, y: 0 })).toBe(0);
  });

  it('together with judgeImpact: two bikes at 4 m/s each are a fall at 6 m/s', () => {
    const closing = relativeNormalSpeed({ vx: -4, vy: 0 }, { vx: 4, vy: 0 }, east);
    expect(judgeImpact(closing, FALL)).toBe('fall');
    expect(judgeImpact(relativeNormalSpeed({ vx: -2, vy: 0 }, { vx: 2, vy: 0 }, east), FALL)).toBe('bump');
  });
});
