import { describe, expect, it } from 'vitest';
import {
  circleVsCircle,
  circleVsOBB,
  circleVsPolygon,
  pointInPolygon,
  type Circle,
  type Contact,
  type Point,
} from '../../../src/physics/collide/shapes.js';

// A square, 10 x 10, corners counter clockwise (x east, y north) and the same square clockwise.
const SQUARE: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const SQUARE_CW: Point[] = [...SQUARE].reverse();

// An L: a bar along the bottom and a bar up the left side. The corner (10, 10) points INTO the shape (concave).
const L_SHAPE: Point[] = [
  { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 },
];
const L_SHAPE_CW: Point[] = [...L_SHAPE].reverse();

const circle = (x: number, y: number, r: number): Circle => ({ x, y, r });

function expectContact(c: Contact | null, depth: number, nx: number, ny: number): void {
  expect(c).not.toBeNull();
  expect(c!.depth).toBeCloseTo(depth, 9);
  expect(c!.normalX).toBeCloseTo(nx, 9);
  expect(c!.normalY).toBeCloseTo(ny, 9);
}

describe('pointInPolygon', () => {
  it('knows inside and outside of a square, whatever the winding', () => {
    for (const sq of [SQUARE, SQUARE_CW]) {
      expect(pointInPolygon(5, 5, sq)).toBe(true);
      expect(pointInPolygon(15, 5, sq)).toBe(false);
      expect(pointInPolygon(-1, 5, sq)).toBe(false);
      expect(pointInPolygon(5, 11, sq)).toBe(false);
    }
  });

  it('works for a concave L: the notch is outside, both arms are inside', () => {
    for (const l of [L_SHAPE, L_SHAPE_CW]) {
      expect(pointInPolygon(15, 5, l)).toBe(true); // the bottom bar
      expect(pointInPolygon(5, 15, l)).toBe(true); // the left bar
      expect(pointInPolygon(5, 5, l)).toBe(true); // the corner of both
      expect(pointInPolygon(15, 15, l)).toBe(false); // the notch
      expect(pointInPolygon(25, 5, l)).toBe(false);
    }
  });

  it('says false for a bad polygon or a bad point', () => {
    expect(pointInPolygon(1, 1, [])).toBe(false);
    expect(pointInPolygon(1, 1, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(pointInPolygon(Number.NaN, 1, SQUARE)).toBe(false);
    expect(pointInPolygon(1, Infinity, SQUARE)).toBe(false);
    expect(pointInPolygon(1, 1, [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('circleVsCircle', () => {
  it('gives depth and the normal from the other circle to this one', () => {
    expectContact(circleVsCircle(circle(2, 0, 1), circle(0, 0, 1.5)), 0.5, 1, 0);
    expectContact(circleVsCircle(circle(0, -2, 1), circle(0, 0, 1.5)), 0.5, 0, -1);
  });

  it('has no contact when apart or exactly touching', () => {
    expect(circleVsCircle(circle(3, 0, 1), circle(0, 0, 1.5))).toBeNull();
    expect(circleVsCircle(circle(2.5, 0, 1), circle(0, 0, 1.5))).toBeNull();
  });

  it('gives the normal +x when the centres are the same, never NaN', () => {
    const c = circleVsCircle(circle(4, 4, 1), circle(4, 4, 0.5));
    expectContact(c, 1.5, 1, 0);
  });

  it('swapping the circles turns the normal around', () => {
    const a = circleVsCircle(circle(1, 1, 1), circle(2, 2, 1))!;
    const b = circleVsCircle(circle(2, 2, 1), circle(1, 1, 1))!;
    expect(a.depth).toBeCloseTo(b.depth, 12);
    expect(a.normalX).toBeCloseTo(-b.normalX, 12);
    expect(a.normalY).toBeCloseTo(-b.normalY, 12);
  });

  it('has no contact for numbers that are not finite or a negative radius', () => {
    expect(circleVsCircle(circle(Number.NaN, 0, 1), circle(0, 0, 1))).toBeNull();
    expect(circleVsCircle(circle(0, 0, Infinity), circle(0, 0, 1))).toBeNull();
    expect(circleVsCircle(circle(0, 0, 1), circle(0, Number.NaN, 1))).toBeNull();
    expect(circleVsCircle(circle(0, 0, -1), circle(0, 0, 1))).toBeNull();
  });
});

describe('circleVsPolygon, centre outside', () => {
  it('pushes away from an edge', () => {
    for (const sq of [SQUARE, SQUARE_CW]) {
      expectContact(circleVsPolygon(circle(10.5, 5, 1), sq), 0.5, 1, 0);
      expectContact(circleVsPolygon(circle(-0.25, 5, 1), sq), 0.75, -1, 0);
      expectContact(circleVsPolygon(circle(5, 10.9, 1), sq), 0.1, 0, 1);
    }
  });

  it('pushes away from a corner along the line from the corner to the centre', () => {
    const r = Math.SQRT1_2;
    expectContact(circleVsPolygon(circle(11, 11, 2), SQUARE), 2 - Math.SQRT2, r, r);
  });

  it('has no contact when touching exactly or when apart', () => {
    expect(circleVsPolygon(circle(11, 5, 1), SQUARE)).toBeNull();
    expect(circleVsPolygon(circle(12, 5, 1), SQUARE)).toBeNull();
    expect(circleVsPolygon(circle(11.5, 11.5, 2), SQUARE)).toBeNull();
  });
});

describe('circleVsPolygon, centre inside', () => {
  it('pushes out through the nearest edge, and the depth includes the radius', () => {
    for (const sq of [SQUARE, SQUARE_CW]) {
      expectContact(circleVsPolygon(circle(9, 5, 1), sq), 2, 1, 0);
      expectContact(circleVsPolygon(circle(5, 1, 0.5), sq), 1.5, 0, -1);
    }
  });

  it('is a contact when the centre is exactly on the edge, out through that edge', () => {
    for (const sq of [SQUARE, SQUARE_CW]) {
      expectContact(circleVsPolygon(circle(10, 5, 1), sq), 1, 1, 0);
    }
  });

  it('has no contact for a point of radius 0 on the edge (nothing overlaps)', () => {
    expect(circleVsPolygon(circle(10, 5, 0), SQUARE)).toBeNull();
  });

  it('a centre on the line of a face is pushed out through that face, not sideways (rounding noise)', () => {
    // A thin barrier at x from 100 to 100.5. At x = 100 the nearest point differs from the
    // centre only by rounding error along the face, which used to give the normal (0, 1).
    const barrier: Point[] = [{ x: 100, y: -50 }, { x: 100.5, y: -50 }, { x: 100.5, y: 50 }, { x: 100, y: 50 }];
    for (const poly of [barrier, [...barrier].reverse()]) {
      for (let y = -40; y <= 40; y += 0.37) {
        for (const x of [100, 100 + 1e-12, 100 - 1e-12]) {
          const c = circleVsPolygon(circle(x, y, 0.6), poly);
          expect(c, `x ${x}, y ${y}`).not.toBeNull();
          expect(c!.normalX, `x ${x}, y ${y}`).toBeCloseTo(-1, 6);
          expect(c!.normalY, `x ${x}, y ${y}`).toBeCloseTo(0, 6);
          expect(c!.depth, `x ${x}, y ${y}`).toBeCloseTo(0.6, 6);
        }
      }
    }
  });
});

describe('circleVsPolygon, concave L shape', () => {
  it('finds the arm that is near, not the middle of the shape', () => {
    for (const l of [L_SHAPE, L_SHAPE_CW]) {
      // In the notch, 3 m from the left bar (x = 10) and 6 m from the bottom bar (y = 10).
      expectContact(circleVsPolygon(circle(13, 16, 4), l), 1, 1, 0);
      // Deep in the notch there is no contact.
      expect(circleVsPolygon(circle(16, 16, 2), l)).toBeNull();
    }
  });

  it('in the notch next to the concave corner it is pushed away from the nearer face, not from the corner', () => {
    for (const l of [L_SHAPE, L_SHAPE_CW]) {
      // 1 m from the face x = 10 and 1.5 m from the face y = 10; the corner (10, 10) is 1.8 m away.
      expectContact(circleVsPolygon(circle(11, 11.5, 2), l), 1, 1, 0);
      expectContact(circleVsPolygon(circle(11.5, 11, 2), l), 1, 0, 1);
    }
  });

  it('a centre inside the L next to the concave corner is pushed out through that corner into the notch', () => {
    const r = Math.SQRT1_2;
    for (const l of [L_SHAPE, L_SHAPE_CW]) {
      // The nearest boundary point of (9, 9) is the corner (10, 10), sqrt(2) away.
      expectContact(circleVsPolygon(circle(9, 9, 1), l), Math.SQRT2 + 1, r, r);
    }
  });

  it('pushes out of an arm through its own outer edge', () => {
    for (const l of [L_SHAPE, L_SHAPE_CW]) {
      expectContact(circleVsPolygon(circle(3, 15, 2), l), 5, -1, 0);
      expectContact(circleVsPolygon(circle(15, 3, 2), l), 5, 0, -1);
    }
  });
});

describe('circleVsPolygon, bad input', () => {
  it('has no contact for numbers that are not finite', () => {
    expect(circleVsPolygon(circle(Number.NaN, 5, 1), SQUARE)).toBeNull();
    expect(circleVsPolygon(circle(5, Infinity, 1), SQUARE)).toBeNull();
    expect(circleVsPolygon(circle(5, 5, Number.NaN), SQUARE)).toBeNull();
    expect(circleVsPolygon(circle(5, 5, -1), SQUARE)).toBeNull();
    const bad = [{ x: 0, y: 0 }, { x: 10, y: Number.NaN }, { x: 10, y: 10 }];
    expect(circleVsPolygon(circle(5, 5, 1), bad)).toBeNull();
  });

  it('has no contact for a polygon with fewer than 3 corners', () => {
    expect(circleVsPolygon(circle(0, 0, 5), [])).toBeNull();
    expect(circleVsPolygon(circle(0, 0, 5), [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBeNull();
  });
});

describe('circleVsOBB', () => {
  const box = (heading: number) => ({ x: 0, y: 0, length: 4, width: 2, heading });

  it('works for a box that is not turned', () => {
    expectContact(circleVsOBB(circle(3, 0, 1.5), box(0)), 0.5, 1, 0); // front
    expectContact(circleVsOBB(circle(0, -1.9, 1), box(0)), 0.1, 0, -1); // side
  });

  it('works for a turned box: the length runs along the heading', () => {
    expectContact(circleVsOBB(circle(0, 3, 1.5), box(Math.PI / 2)), 0.5, 0, 1);
    const c = Math.SQRT1_2;
    expectContact(circleVsOBB(circle(3 * c, 3 * c, 1.5), box(Math.PI / 4)), 0.5, c, c);
  });

  it('pushes away from a corner', () => {
    const r = Math.SQRT1_2;
    expectContact(circleVsOBB(circle(2.5, 1.5, 1), box(0)), 1 - Math.SQRT1_2, r, r);
  });

  it('has no contact when touching exactly or apart', () => {
    expect(circleVsOBB(circle(3, 0, 1), box(0))).toBeNull();
    expect(circleVsOBB(circle(5, 5, 1), box(0.7))).toBeNull();
  });

  it('pushes out through the nearest side when the centre is inside', () => {
    // Inside, 1.5 from the front side and 1 from the long side: out through the long side.
    expectContact(circleVsOBB(circle(0.5, 0, 1), box(0)), 2, 0, 1);
    expectContact(circleVsOBB(circle(1.9, 0.1, 0.5), box(0)), 0.6, 1, 0);
  });

  it('has no contact for a box with no size or numbers that are not finite', () => {
    expect(circleVsOBB(circle(0, 0, 1), { x: 0, y: 0, length: 0, width: 2, heading: 0 })).toBeNull();
    expect(circleVsOBB(circle(0, 0, 1), { x: 0, y: 0, length: 4, width: -2, heading: 0 })).toBeNull();
    expect(circleVsOBB(circle(0, 0, 1), { x: 0, y: 0, length: 4, width: 2, heading: Number.NaN })).toBeNull();
    expect(circleVsOBB(circle(Number.NaN, 0, 1), box(0))).toBeNull();
  });
});

describe('all tests together', () => {
  const shapes: Array<[string, (c: Circle) => Contact | null]> = [
    ['square', (c) => circleVsPolygon(c, SQUARE)],
    ['L', (c) => circleVsPolygon(c, L_SHAPE)],
    ['box', (c) => circleVsOBB(c, { x: 10, y: 10, length: 6, width: 3, heading: 0.6 })],
    ['circle', (c) => circleVsCircle(c, { x: 10, y: 10, r: 4 })],
  ];

  it('give a unit normal and a depth above 0, and a push of the depth ends the contact', () => {
    let contacts = 0;
    for (const [name, test] of shapes) {
      for (let x = -6; x <= 26; x += 1.3) {
        for (let y = -6; y <= 26; y += 1.3) {
          for (const r of [0.3, 0.6, 2]) {
            const c = test(circle(x, y, r));
            if (c === null) continue;
            contacts++;
            const label = `${name} at (${x.toFixed(1)}, ${y.toFixed(1)}) r ${r}`;
            expect(Math.hypot(c.normalX, c.normalY), label).toBeCloseTo(1, 9);
            expect(c.depth, label).toBeGreaterThan(0);
            // Only the shapes with a flat or round outside are checked after the push; inside a
            // concave notch a push can end in the other arm, which the next substep handles.
            if (name !== 'L') {
              const moved = circle(x + c.normalX * (c.depth + 1e-6), y + c.normalY * (c.depth + 1e-6), r);
              expect(test(moved), `${label} after the push`).toBeNull();
            }
          }
        }
      }
    }
    expect(contacts).toBeGreaterThan(200);
  });
});
