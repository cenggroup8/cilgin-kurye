// A fast motorcycle must never get to the other side of a thin wall (issue #39:
// "hiçbir şey duvardan geçmez"). Each step first moves the circle, then finds the
// contact and resolves it, like one substep of the physics part will do.
import { describe, expect, it } from 'vitest';
import { BARRIER_THICKNESS_M, BIKE_RADIUS_M } from '../../../src/physics/collide/constants.js';
import { resolveContact, type BikeMotion } from '../../../src/physics/collide/resolve.js';
import { circleVsPolygon, type Point } from '../../../src/physics/collide/shapes.js';

const H = 1 / 60; // one substep (2 per tick at 30 ticks per second)
const WALL_X = 100;

/** A barrier across the road: thin in x, long in y. */
const BARRIER: Point[] = [
  { x: WALL_X, y: -50 },
  { x: WALL_X + BARRIER_THICKNESS_M, y: -50 },
  { x: WALL_X + BARRIER_THICKNESS_M, y: 50 },
  { x: WALL_X, y: 50 },
];

/** Drives east at a fixed speed (like a rider who holds full throttle) for many steps. Returns the largest x of the centre. */
function drive(startX: number, speed: number, steps: number, resolve = true): number {
  let bike: BikeMotion = { x: startX, y: 0.7, heading: 0, speed, slip: 0 };
  let furthest = bike.x;
  for (let i = 0; i < steps; i++) {
    bike = { ...bike, x: bike.x + speed * H, speed }; // 1. move
    const contact = circleVsPolygon({ x: bike.x, y: bike.y, r: BIKE_RADIUS_M }, BARRIER); // 2. find the contact
    if (resolve && contact) bike = resolveContact(bike, contact); // 3. push out
    furthest = Math.max(furthest, bike.x);
  }
  return furthest;
}

describe('a fast motorcycle and a thin barrier', () => {
  const TOP = 30 * 1.5; // the highest top speed of the admin (30 m/s) times the highest speed factor (1.5)

  it('one step at the highest speed is shorter than the radius plus half the thickness (the rule that makes it safe)', () => {
    expect(TOP * H).toBeLessThan(BIKE_RADIUS_M + BARRIER_THICKNESS_M / 2);
  });

  it('never gets to the other side at 45 m/s, from many starting positions', () => {
    for (let k = 0; k < 60; k++) {
      const startX = 60 + (k / 60) * TOP * H; // all phases of the step
      const furthest = drive(startX, TOP, 200);
      expect(furthest, `start ${startX}`).toBeLessThan(WALL_X);
    }
  });

  it('never gets to the other side at slower speeds either', () => {
    for (const speed of [5, 15, 25, 35, 45]) {
      for (let k = 0; k < 20; k++) {
        const furthest = drive(70 + (k / 20) * speed * H, speed, 200);
        expect(furthest, `${speed} m/s, start ${k}`).toBeLessThan(WALL_X);
      }
    }
  });

  it('without the push out it does go through (so the test above really tests the push)', () => {
    expect(drive(60, TOP, 200, false)).toBeGreaterThan(WALL_X + BARRIER_THICKNESS_M);
  });

  it('a step that is longer than radius plus half the thickness can get through (the limit is real)', () => {
    // 75 m/s is 1.25 m per step, above 0.85 m: some starting positions end on the far side.
    let through = 0;
    for (let k = 0; k < 60; k++) {
      if (drive(60 + (k / 60) * 75 * H, 75, 200) > WALL_X + BARRIER_THICKNESS_M) through++;
    }
    expect(through).toBeGreaterThan(0);
  });
});
