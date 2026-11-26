/**
 * One physics tick. This file is the only place that knows the order of the
 * work (module document 7.5, figure "One physics step").
 *
 * Every tick has SUBSTEPS_PER_TICK substeps. Every substep runs the five
 * stages in SUBSTEP_ORDER. Each package fills its own stages:
 *   speedAndSteering, gripAndSliding   M3-1 motorcycle model
 *   wallsAndObstacles, carsAndBikes,
 *   fallCheck                           M3-2 collision solver and fall judge
 */
import type { CarHit } from '../traffic/npc/types';
import type { BikeInput, BikeState, PhysicsEvent, PhysicsInput, PhysicsOutput } from './types';
import type { PhysicsWorld } from './world';

/** Small steps keep fast motorcycles from passing through thin walls. */
export const SUBSTEPS_PER_TICK = 2;

export const SUBSTEP_ORDER = [
  'speedAndSteering',
  'gripAndSliding',
  'wallsAndObstacles',
  'carsAndBikes',
  'fallCheck',
] as const;

export type StageName = (typeof SUBSTEP_ORDER)[number];

/** What a stage can read and write in one substep. */
export interface SubstepContext {
  world: PhysicsWorld;
  input: PhysicsInput;
  /** Substep length in seconds (input.dt / SUBSTEPS_PER_TICK). */
  h: number;
  /** Number of the substep in this tick, from 0. */
  substep: number;
  /** Controls of this tick by player. A player without controls keeps still. */
  controls: ReadonlyMap<number, BikeInput>;
  /** Stages add their events here. */
  events: PhysicsEvent[];
  carHits: CarHit[];
}

export type Stage = (ctx: SubstepContext) => void;
export type PhysicsStages = Readonly<Record<StageName, Stage>>;

const nothing: Stage = () => {};

/** Stages that do nothing. A package replaces its own stages, the others stay empty. */
export const EMPTY_STAGES: PhysicsStages = {
  speedAndSteering: nothing,
  gripAndSliding: nothing,
  wallsAndObstacles: nothing,
  carsAndBikes: nothing,
  fallCheck: nothing,
};

export function stepPhysics(
  world: PhysicsWorld,
  input: PhysicsInput,
  stages: PhysicsStages,
): PhysicsOutput {
  // Falls and stand ups from M1 come first, once per tick.
  for (const id of input.fall) {
    const bike = world.bikes.get(id);
    if (bike) {
      bike.fallen = true;
      bike.speed = 0;
      bike.slip = 0;
      bike.sliding = false;
    }
  }
  for (const id of input.standUp) {
    const bike = world.bikes.get(id);
    if (bike) bike.fallen = false;
  }

  const controls = new Map<number, BikeInput>();
  for (const b of input.bikes) {
    controls.set(b.player, b);
    const bike = world.bikes.get(b.player);
    // The server has used this control, even if the motorcycle is down.
    if (bike) bike.lastSeq = b.control.seq;
  }

  const events: PhysicsEvent[] = [];
  const carHits: CarHit[] = [];
  const h = input.dt / SUBSTEPS_PER_TICK;
  for (let substep = 0; substep < SUBSTEPS_PER_TICK; substep++) {
    const ctx: SubstepContext = { world, input, h, substep, controls, events, carHits };
    for (const name of SUBSTEP_ORDER) stages[name](ctx);
  }

  const bikes: BikeState[] = [...world.bikes.values()]
    .sort((a, b) => a.id - b.id)
    .map((bike) => ({ ...bike }));
  return { tick: input.tick, bikes, events, carHits };
}
