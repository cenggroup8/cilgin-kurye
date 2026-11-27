import { describe, expect, it } from 'vitest';
import { addBike, BIKE_STAGES, createWorld, EMPTY_STAGES, stepPhysics } from '../../../src/physics/index.js';
import { BIKE_RADIUS_M } from '../../../src/physics/collide/constants.js';
import {
  impactSpeedOf,
  PUSH_MARGIN_M,
  resolveContact,
  velocityOf,
  type BikeMotion,
} from '../../../src/physics/collide/resolve.js';
import { circleVsPolygon, type Contact, type Point } from '../../../src/physics/collide/shapes.js';

const bike = (over: Partial<BikeMotion> = {}): BikeMotion => ({ x: 0, y: 0, heading: 0, speed: 0, slip: 0, ...over });
const R = Math.SQRT1_2;

// A wall on the east: the bike drives east into it, the normal points from the wall to the bike (west).
const head_on: Contact = { depth: 0.1, normalX: -1, normalY: 0 };

describe('velocityOf: speed is forward, slip is to the LEFT of the rider', () => {
  it('forward is along the heading', () => {
    expect(velocityOf(bike({ speed: 5 }))).toEqual({ vx: 5, vy: 0 });
    const north = velocityOf(bike({ heading: Math.PI / 2, speed: 5 }));
    expect(north.vx).toBeCloseTo(0, 12);
    expect(north.vy).toBeCloseTo(5, 12);
  });

  it('a positive slip goes to the left: heading east, left is north', () => {
    const v = velocityOf(bike({ slip: 2 }));
    expect(v.vx).toBeCloseTo(0, 12);
    expect(v.vy).toBeCloseTo(2, 12);
  });

  it('a positive slip goes to the left: heading north, left is west', () => {
    const v = velocityOf(bike({ heading: Math.PI / 2, slip: 2 }));
    expect(v.vx).toBeCloseTo(-2, 12);
    expect(v.vy).toBeCloseTo(0, 12);
  });

  it('is the same rule that the motorcycle model uses to move', () => {
    // Heading north, no speed, a positive slip: the real model moves the bike to the west.
    const world = createWorld();
    const b = addBike(world, 0, { x: 0, y: 0, heading: Math.PI / 2 });
    b.slip = 2;
    const v = velocityOf(b);
    stepPhysics(world, { tick: 0, dt: 1 / 30, bikes: [], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [] }, { ...EMPTY_STAGES, ...BIKE_STAGES });
    expect(v.vx).toBeLessThan(0);
    expect(b.x).toBeLessThan(0);
    expect(Math.sign(b.x)).toBe(Math.sign(v.vx));
  });
});

describe('impactSpeedOf', () => {
  it('is the speed into the shape', () => {
    expect(impactSpeedOf(bike({ speed: 5 }), head_on)).toBeCloseTo(5, 12);
  });

  it('counts only the part along the normal when the hit is at an angle', () => {
    const slanted: Contact = { depth: 0.1, normalX: -R, normalY: R };
    expect(impactSpeedOf(bike({ speed: 6 }), slanted)).toBeCloseTo(6 * R, 12);
  });

  it('is 0 when moving away, along the shape or standing', () => {
    expect(impactSpeedOf(bike({ speed: 5, heading: Math.PI }), head_on)).toBe(0); // driving west, away
    expect(impactSpeedOf(bike({ speed: 5, heading: Math.PI / 2 }), head_on)).toBeCloseTo(0, 12); // along the wall
    expect(impactSpeedOf(bike(), head_on)).toBe(0);
  });

  it('counts the slip too', () => {
    // Heading north, sliding left (west) into a wall on the west side whose normal points east.
    expect(impactSpeedOf(bike({ heading: Math.PI / 2, slip: 3 }), { depth: 0.1, normalX: 1, normalY: 0 })).toBeCloseTo(3, 12);
  });

  it('is 0 for numbers that are not finite', () => {
    expect(impactSpeedOf(bike({ speed: Number.NaN }), head_on)).toBe(0);
    expect(impactSpeedOf(bike({ speed: 5 }), { depth: 0.1, normalX: Number.NaN, normalY: 0 })).toBe(0);
  });
});

describe('resolveContact', () => {
  it('a slow hit straight on: the bike is pushed out and stops', () => {
    const out = resolveContact(bike({ x: 9.5, speed: 2 }), head_on);
    expect(out.x).toBeCloseTo(9.5 - 0.1 - PUSH_MARGIN_M, 12);
    expect(out.speed).toBeCloseTo(0, 12);
    expect(out.slip).toBeCloseTo(0, 12);
  });

  it('keeps the side speed along the shape: a scrape is not stopped', () => {
    // Driving east at 6 m/s into a wall at 45 degrees: half of the speed is along the wall.
    const slanted: Contact = { depth: 0.2, normalX: -R, normalY: R };
    const out = resolveContact(bike({ speed: 6 }), slanted);
    // v = (6, 0); v.n = -6R; v' = v - (v.n) n = (6 - 3, 0 + 3) = (3, 3).
    expect(out.speed).toBeCloseTo(3, 9);
    expect(out.slip).toBeCloseTo(3, 9);
    expect(out.x).toBeCloseTo(-R * (0.2 + PUSH_MARGIN_M), 12);
    expect(out.y).toBeCloseTo(R * (0.2 + PUSH_MARGIN_M), 12);
  });

  it('after the push the bike no longer drives into the shape', () => {
    const slanted: Contact = { depth: 0.2, normalX: -R, normalY: R };
    const out = resolveContact(bike({ speed: 6, slip: -1 }), slanted);
    const { vx, vy } = velocityOf(out);
    expect(vx * slanted.normalX + vy * slanted.normalY).toBeGreaterThanOrEqual(-1e-12);
  });

  it('a bike that moves away keeps its velocity and is only pushed', () => {
    const out = resolveContact(bike({ x: 9.5, speed: 4, heading: Math.PI }), head_on);
    expect(out.speed).toBeCloseTo(4, 12);
    expect(out.slip).toBeCloseTo(0, 12);
    expect(out.x).toBeCloseTo(9.5 - 0.1 - PUSH_MARGIN_M, 12);
  });

  it('keeps the heading and the part of the velocity along the wall (the forward speed may be negative)', () => {
    // A bike that mostly slides sideways into a wall: what stays is the part along the wall, even if it points backwards.
    const input = bike({ heading: 0.3, speed: 0.5, slip: -8 });
    const contact = { depth: 0.1, normalX: -R, normalY: R };
    const out = resolveContact(input, contact);
    expect(out.heading).toBe(0.3);
    const before = velocityOf(input);
    const into = before.vx * contact.normalX + before.vy * contact.normalY;
    const after = velocityOf(out);
    expect(after.vx).toBeCloseTo(before.vx - into * contact.normalX, 9);
    expect(after.vy).toBeCloseTo(before.vy - into * contact.normalY, 9);
  });

  it('does not change its input and gives a new object', () => {
    const input = Object.freeze(bike({ x: 1, y: 2, heading: 0.5, speed: 7, slip: 1 }));
    const contact = Object.freeze({ depth: 0.3, normalX: -1, normalY: 0 });
    const out = resolveContact(input, contact);
    expect(out).not.toBe(input);
    expect(input).toEqual({ x: 1, y: 2, heading: 0.5, speed: 7, slip: 1 });
    expect(contact).toEqual({ depth: 0.3, normalX: -1, normalY: 0 });
  });

  it('a bike with a number that is not finite is given back unchanged (as a copy)', () => {
    const input = bike({ x: Number.NaN, speed: 5 });
    const out = resolveContact(input, head_on);
    expect(out).not.toBe(input);
    expect(Number.isNaN(out.x)).toBe(true);
    expect(out.speed).toBe(5);
  });
});

describe('push and contact', () => {
  // A wall 5 m long and 0.5 m thick, standing at x from 10 to 10.5.
  const WALL: Point[] = [{ x: 10, y: -2.5 }, { x: 10.5, y: -2.5 }, { x: 10.5, y: 2.5 }, { x: 10, y: 2.5 }];

  it('after the push there is no contact left', () => {
    for (const x of [9.5, 9.7, 9.99, 10.2, 10.4, 10.6, 10.9]) {
      for (const y of [-2, 0, 1.3, 2.6]) {
        const circle = { x, y, r: BIKE_RADIUS_M };
        const contact = circleVsPolygon(circle, WALL);
        if (contact === null) continue;
        const out = resolveContact(bike({ x, y, speed: 3 }), contact);
        expect(circleVsPolygon({ x: out.x, y: out.y, r: BIKE_RADIUS_M }, WALL), `x ${x}, y ${y}`).toBeNull();
      }
    }
  });
});
