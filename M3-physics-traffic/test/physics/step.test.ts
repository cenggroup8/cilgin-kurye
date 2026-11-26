import { describe, expect, it } from 'vitest';
import {
  addBike,
  applyParamChanges,
  createWorld,
  DEFAULT_PHYSICS_PARAMS,
  EMPTY_STAGES,
  stepPhysics,
  SUBSTEP_ORDER,
  type PhysicsInput,
  type StageName,
} from '../../src/physics';

function input(over: Partial<PhysicsInput> = {}): PhysicsInput {
  return { tick: 1, dt: 1 / 30, bikes: [], obstacles: [], npcCars: [], quake: null, fall: [], standUp: [], ...over };
}

function control(player: number, seq: number) {
  return { player, speedFactor: 1, control: { throttle: 1, brake: 0, steer: 0, seq } };
}

describe('one physics tick', () => {
  it('runs the five stages in the fixed order, two substeps per tick', () => {
    const calls: string[] = [];
    const hs: number[] = [];
    const stages = Object.fromEntries(
      SUBSTEP_ORDER.map((name) => [name, (ctx: { substep: number; h: number }) => {
        calls.push(`${ctx.substep}:${name}`);
        hs.push(ctx.h);
      }]),
    ) as Record<StageName, (ctx: { substep: number; h: number }) => void>;

    stepPhysics(createWorld(), input(), stages);

    expect(SUBSTEP_ORDER).toEqual(['speedAndSteering', 'gripAndSliding', 'wallsAndObstacles', 'carsAndBikes', 'fallCheck']);
    expect(calls).toEqual([...SUBSTEP_ORDER.map((n) => `0:${n}`), ...SUBSTEP_ORDER.map((n) => `1:${n}`)]);
    for (const h of hs) expect(h).toBeCloseTo(1 / 60, 12);
  });

  it('applies the falls and stand ups from M1 before the substeps', () => {
    const world = createWorld();
    addBike(world, 0, { x: 0, y: 0, heading: 0 }).speed = 10;
    addBike(world, 1, { x: 5, y: 0, heading: 0 }).fallen = true;
    const seen: boolean[] = [];
    stepPhysics(world, input({ fall: [0], standUp: [1] }), {
      ...EMPTY_STAGES,
      speedAndSteering: (ctx) => {
        seen.push(ctx.world.bikes.get(0)!.fallen, ctx.world.bikes.get(1)!.fallen);
      },
    });
    expect(seen.slice(0, 2)).toEqual([true, false]);
    expect(world.bikes.get(0)!.speed).toBe(0);
  });

  it('keeps the number of the last control the server used, also for a fallen motorcycle', () => {
    const world = createWorld();
    addBike(world, 3, { x: 0, y: 0, heading: 0 }).fallen = true;
    const out = stepPhysics(world, input({ bikes: [control(3, 42)] }), EMPTY_STAGES);
    expect(out.bikes[0].lastSeq).toBe(42);
  });

  it('gives the motorcycles sorted by player as copies', () => {
    const world = createWorld();
    addBike(world, 5, { x: 0, y: 0, heading: 0 });
    addBike(world, 2, { x: 0, y: 0, heading: 0 });
    const out = stepPhysics(world, input(), EMPTY_STAGES);
    expect(out.bikes.map((b) => b.id)).toEqual([2, 5]);
    out.bikes[0].x = 99;
    expect(world.bikes.get(2)!.x).toBe(0);
  });

  it('collects the events and car hits of all stages', () => {
    const out = stepPhysics(createWorld(), input({ tick: 7 }), {
      ...EMPTY_STAGES,
      fallCheck: (ctx) => {
        ctx.events.push({ kind: 'fall', player: 1, cause: 'wall', impactSpeed: 9 });
        ctx.carHits.push({ carId: 4, impactSpeed: 3 });
      },
    });
    expect(out.tick).toBe(7);
    expect(out.events).toHaveLength(2);
    expect(out.carHits).toHaveLength(2);
  });
});

describe('physics parameters', () => {
  it('takes changes by their admin names and ignores other names', () => {
    const p = applyParamChanges(DEFAULT_PHYSICS_PARAMS, {
      'physics.top_speed_mps': 20,
      'quake.grip': 0.3,
      'physics.npc_count': 40,
    });
    expect(p.topSpeed).toBe(20);
    expect(p.gripQuake).toBe(0.3);
    expect(p.grip).toBe(DEFAULT_PHYSICS_PARAMS.grip);
    expect(DEFAULT_PHYSICS_PARAMS.topSpeed).toBe(15);
  });
});
