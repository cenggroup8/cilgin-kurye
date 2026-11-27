/**
 * Fake M1 (issue #38): plays the role of the game server for M3 tests and the
 * test page. It builds the world from the city plan, gives the scripted
 * controls, obstacles and earthquake of a scenario, and calls M3 in the same
 * order as M1: first the traffic part, then the physics part.
 */
import type { Obstacle } from '../../src/common/types.js';
import {
  addBike,
  BIKE_STAGES,
  COLLIDE_STAGES,
  createWorld,
  EMPTY_STAGES,
  stepPhysics,
  type BikeState,
  type PhysicsOutput,
  type PhysicsStages,
  type PhysicsWorld,
  type QuakeArea,
} from '../../src/physics/index.js';
import { NpcTraffic, type CarHit, type NpcCarPose } from '../../src/traffic/npc/index.js';
import { m3City, type M3City } from './cityPlan.js';

export interface Ctl {
  throttle?: number;
  brake?: number;
  steer?: number;
}

/** Something that happens at one tick of a scenario. */
export interface ScenarioEvent {
  at: number;
  /** The new obstacle list (replaces the old one). */
  obstacles?: Obstacle[];
  /** Start (area) or end (null) an earthquake. */
  quake?: QuakeArea | null;
  fall?: number[];
  standUp?: number[];
}

export interface Scenario {
  seed: number;
  /** Player numbers; player n plays for team floor(n / 2) and starts at its store. */
  players: number[];
  /** Control of a player at a tick. It may look at the motorcycle. */
  control: (tick: number, player: number, bike: BikeState) => Ctl;
  events?: ScenarioEvent[];
  /** Number of NPC cars; 0 means no traffic. */
  npcCars?: number;
  speedFactor?: Record<number, number>;
}

export interface FakeTick {
  tick: number;
  cars: NpcCarPose[];
  physics: PhysicsOutput;
}

export class FakeM1 {
  readonly dt = 1 / 30;
  readonly city: M3City;
  readonly physics: PhysicsWorld;
  readonly traffic: NpcTraffic | null;
  tick = 0;
  obstacles: Obstacle[] = [];
  quake: QuakeArea | null = null;
  private carHits: CarHit[] = [];
  private cars: NpcCarPose[] = [];

  constructor(
    readonly scenario: Scenario,
    private readonly stages: PhysicsStages = { ...EMPTY_STAGES, ...BIKE_STAGES, ...COLLIDE_STAGES },
    city: M3City = m3City(),
  ) {
    this.city = city;
    this.physics = createWorld();
    // Buildings and the outer wall come from the city plan (x east, y north; the plan's z runs south).
    this.physics.buildings = city.buildings.map((b) => b.polygon);
    this.physics.bounds = { minX: 0, maxX: city.size, minY: -city.size, maxY: 0 };
    for (const p of scenario.players) {
      const store = city.stores[Math.floor(p / 2)];
      addBike(this.physics, p, { x: store.x, y: store.y, heading: store.heading });
    }
    const n = scenario.npcCars ?? 0;
    this.traffic = n > 0 ? new NpcTraffic(city.graph, { seed: scenario.seed, params: { carCount: n } }) : null;
  }

  /** One server tick: events, traffic, physics. */
  step(): FakeTick {
    const t = this.tick;
    const fall: number[] = [];
    const standUp: number[] = [];
    for (const e of this.scenario.events ?? []) {
      if (e.at !== t) continue;
      if (e.obstacles) this.obstacles = e.obstacles;
      if (e.quake !== undefined) this.quake = e.quake;
      fall.push(...(e.fall ?? []));
      standUp.push(...(e.standUp ?? []));
    }

    const bikes = [...this.physics.bikes.values()].sort((a, b) => a.id - b.id);
    if (this.traffic) {
      const players = bikes.map((b) => ({ id: b.id, x: b.x, y: b.y, heading: b.heading, speed: b.speed, fallen: b.fallen }));
      this.cars = this.traffic.step({ dt: this.dt, players, obstacles: this.obstacles, carHits: this.carHits }).cars;
    }

    const physics = stepPhysics(
      this.physics,
      {
        tick: t,
        dt: this.dt,
        bikes: bikes.map((b) => {
          const c = this.scenario.control(t, b.id, b);
          return {
            player: b.id,
            speedFactor: this.scenario.speedFactor?.[b.id] ?? 1,
            control: { throttle: c.throttle ?? 0, brake: c.brake ?? 0, steer: c.steer ?? 0, seq: t },
          };
        }),
        obstacles: this.obstacles,
        npcCars: this.cars,
        quake: this.quake,
        fall,
        standUp,
      },
      this.stages,
    );
    // Car hits go to the traffic part in the next tick (module document 7.5).
    this.carHits = physics.carHits;
    this.tick++;
    return { tick: t, cars: this.cars, physics };
  }

  run(ticks: number): FakeTick[] {
    const out: FakeTick[] = [];
    for (let i = 0; i < ticks; i++) out.push(this.step());
    return out;
  }
}
