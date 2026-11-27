// Fast vehicles must not pass through each other (issue #39). The test of a
// contact looks at one moment of one substep, so a motorcycle that moves more than
// the thickness of the other thing in one substep can end on the far side.
import { describe, expect, it } from 'vitest';
import { addBike, COLLIDE_STAGES, createWorld, EMPTY_STAGES, stepPhysics, type PhysicsStages } from '../../../src/physics/index.js';
import { BIKE_RADIUS_M, NPC_MAX_SPEED_MPS } from '../../../src/physics/collide/constants.js';
import type { NpcCarPose } from '../../../src/traffic/npc/types.js';

const H = 1 / 60; // one substep (2 per tick at 30 ticks per second)
const NPC_HALF_WIDTH = 0.9;
const ADMIN_MAX_TOP_SPEED = 30; // physics.top_speed_mps max
const MAX_SPEED_FACTOR = 1.5; // players.<n>.speed_factor max

describe('guards from the constants', () => {
  it('motorcycle against an NPC car: the closing speed in one substep is below radius + half the narrow side', () => {
    const closing = ADMIN_MAX_TOP_SPEED * MAX_SPEED_FACTOR + NPC_MAX_SPEED_MPS; // 45 + 20 m/s
    const move = closing * H;
    const limit = BIKE_RADIUS_M + NPC_HALF_WIDTH;
    expect(
      move,
      `A motorcycle (45 m/s) and a car (${NPC_MAX_SPEED_MPS} m/s) close ${move} m per substep, but radius + half width is only ${limit} m. ` +
        'The motorcycle could pass through the side of a car. Use more substeps or a swept test.',
    ).toBeLessThan(limit);
  });

  it('two motorcycles at the admin top speed with factor 1.0: 2 x 30 m/s x h is below two radii', () => {
    const move = 2 * ADMIN_MAX_TOP_SPEED * H;
    expect(move, `Two motorcycles close ${move} m per substep, a motorcycle is ${2 * BIKE_RADIUS_M} m wide.`).toBeLessThan(2 * BIKE_RADIUS_M);
  });
});

/** Moves everything by its speed (like the motorcycle model), then runs the collision stage. */
function stages(cars: NpcCarPose[]): PhysicsStages {
  return {
    ...EMPTY_STAGES,
    speedAndSteering: (ctx) => {
      for (const b of ctx.world.bikes.values()) {
        if (b.fallen) continue;
        b.x += b.speed * Math.cos(b.heading) * ctx.h;
        b.y += b.speed * Math.sin(b.heading) * ctx.h;
      }
      for (const c of cars) {
        c.x += c.speed * Math.cos(c.heading) * ctx.h;
        c.y += c.speed * Math.sin(c.heading) * ctx.h;
      }
    },
    ...COLLIDE_STAGES,
  };
}

function input(tick: number, npcCars: NpcCarPose[]) {
  return { tick, dt: 1 / 30, bikes: [], obstacles: [], npcCars, quake: null, fall: [], standUp: [] };
}

/** Two motorcycles drive at each other. Returns how many of 60 starting phases end with A on the wrong side. */
function headOn(speed: number): number {
  let wrong = 0;
  for (let k = 0; k < 60; k++) {
    const world = createWorld();
    const a = addBike(world, 0, { x: 0, y: 0, heading: 0 });
    const b = addBike(world, 1, { x: 8 + (k / 60) * 2 * speed * H, y: 0, heading: Math.PI });
    a.speed = speed;
    b.speed = speed;
    const st = stages([]);
    let met = false;
    for (let t = 0; t < 30 && !met; t++) {
      const out = stepPhysics(world, input(t, []), st);
      met = out.events.length > 0;
    }
    if (!met || a.x > b.x) wrong++;
  }
  return wrong;
}

describe('motorcycle against motorcycle', () => {
  it('never pass through each other head on at 15 and 30 m/s each (factor 1.0)', () => {
    expect(headOn(15)).toBe(0);
    expect(headOn(ADMIN_MAX_TOP_SPEED)).toBe(0);
  });

  it('known limit: at 45 m/s each (top speed 30, factor 1.5) they can pass through each other', () => {
    // Closing speed 90 m/s is 1.5 m per substep, wider than the 1.2 m of two radii.
    // This test documents the limit and is not a bug report. To be asked of LatifY:
    // SUBSTEPS_PER_TICK 2 -> 3 (step.ts), or a swept test for motorcycle against motorcycle.
    expect(headOn(ADMIN_MAX_TOP_SPEED * MAX_SPEED_FACTOR)).toBeGreaterThan(0);
  });
});

describe('motorcycle against an NPC car', () => {
  it('never passes through a car that drives at it head on, at 45 m/s and 20 m/s', () => {
    for (let k = 0; k < 60; k++) {
      const world = createWorld();
      const bike = addBike(world, 0, { x: 0, y: 0, heading: 0 });
      bike.speed = ADMIN_MAX_TOP_SPEED * MAX_SPEED_FACTOR;
      const car: NpcCarPose = {
        id: 1, x: 40 + (k / 60) * (45 + NPC_MAX_SPEED_MPS) * H, y: 0, heading: Math.PI, speed: NPC_MAX_SPEED_MPS,
        edgeId: null, lane: 0, length: 4.5, width: 1.8, state: 'driving',
      };
      const st = stages([car]);
      let met = false;
      for (let t = 0; t < 40 && !met; t++) met = stepPhysics(world, input(t, [car]), st).events.length > 0;
      expect(met, `phase ${k}`).toBe(true);
      expect(bike.x, `phase ${k}`).toBeLessThan(car.x); // still on the near side of the car
    }
  });

  it('never passes through the side of a car that crosses its way', () => {
    for (let k = 0; k < 60; k++) {
      const world = createWorld();
      const bike = addBike(world, 0, { x: 0, y: -(14 + (k / 60) * ADMIN_MAX_TOP_SPEED * MAX_SPEED_FACTOR * H), heading: Math.PI / 2 }); // drives north
      bike.speed = ADMIN_MAX_TOP_SPEED * MAX_SPEED_FACTOR;
      const car: NpcCarPose = {
        id: 1, x: 0, y: 0, heading: 0, speed: 0,
        edgeId: null, lane: 0, length: 4.5, width: 1.8, state: 'stopped',
      };
      const st = stages([car]);
      let met = false;
      for (let t = 0; t < 40 && !met; t++) met = stepPhysics(world, input(t, [car]), st).events.length > 0;
      expect(met, `phase ${k}`).toBe(true);
      expect(bike.y, `phase ${k}`).toBeLessThan(0); // south of the car
    }
  });
});
