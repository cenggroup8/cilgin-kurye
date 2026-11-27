import { describe, expect, it } from "vitest";
import { SeededRng } from "../src/loop/rng.js";
import {
  runTick,
  noopAdmin,
  noopMatch,
  noopDelivery,
  noopHazards,
  type M3Proxy,
  type TickDeps,
} from "../src/loop/tick.js";
import { emptyTickInput, type PhysicsOutput, type TrafficOutput } from "../src/loop/types.js";
import {
  createInitialWorld,
  COUNTDOWN_TICKS,
  MATCH_DURATION_TICKS,
  defaultPose,
  MAX_PLAYERS,
} from "../src/state/world.js";
import { GameLoop } from "../src/loop/game-loop.js";

function stubM3(): M3Proxy {
  return {
    traffic: (): TrafficOutput => ({
      npcCars: [],
      botControls: [],
      travelTimes: [],
      trafficMetrics: { npcCount: 0, meanNpcSpeed: 0, botRouteChanges: 0 },
    }),
    physics: (): PhysicsOutput => ({
      poses: Array.from({ length: MAX_PLAYERS }, () => defaultPose()),
      collisions: [],
      falls: [],
    }),
  };
}

function deps(overrides?: Partial<TickDeps>): TickDeps {
  return {
    admin: noopAdmin,
    match: noopMatch,
    delivery: noopDelivery,
    hazards: noopHazards,
    m3: stubM3(),
    hooks: [],
    ...overrides,
  };
}

describe("runTick", () => {
  it("increments tick number", () => {
    const world = createInitialWorld();
    const rng = new SeededRng(1);
    runTick(world, emptyTickInput(), rng, deps());
    expect(world.tick).toBe(1);
    runTick(world, emptyTickInput(), rng, deps());
    expect(world.tick).toBe(2);
  });

  it("does not advance game time in lobby", () => {
    const world = createInitialWorld();
    world.phase = "lobby";
    runTick(world, emptyTickInput(), new SeededRng(1), deps());
    expect(world.gameTimeTicks).toBe(0);
  });

  it("counts down in countdown phase", () => {
    const world = createInitialWorld();
    world.phase = "countdown";
    world.countdownTicks = 3;
    const rng = new SeededRng(1);
    const d = deps();
    runTick(world, emptyTickInput(), rng, d);
    expect(world.countdownTicks).toBe(2);
    runTick(world, emptyTickInput(), rng, d);
    expect(world.countdownTicks).toBe(1);
    runTick(world, emptyTickInput(), rng, d);
    expect(world.phase).toBe("playing");
  });

  it("advances game time in playing phase", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    const rng = new SeededRng(1);
    const d = deps();
    runTick(world, emptyTickInput(), rng, d);
    expect(world.gameTimeTicks).toBe(1);
    runTick(world, emptyTickInput(), rng, d);
    expect(world.gameTimeTicks).toBe(2);
  });

  it("does not advance game time when paused", () => {
    const world = createInitialWorld();
    world.phase = "paused";
    runTick(world, emptyTickInput(), new SeededRng(1), deps());
    expect(world.gameTimeTicks).toBe(0);
  });

  it("ends the game after 5 minutes of play", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    world.gameTimeTicks = MATCH_DURATION_TICKS - 1;
    runTick(world, emptyTickInput(), new SeededRng(1), deps());
    expect(world.phase).toBe("ended");
  });

  it("calls hooks after tick", () => {
    const world = createInitialWorld();
    const called: number[] = [];
    const d = deps({
      hooks: [{ afterTick: (w) => called.push(w.tick) }],
    });
    runTick(world, emptyTickInput(), new SeededRng(1), d);
    runTick(world, emptyTickInput(), new SeededRng(1), d);
    expect(called).toEqual([1, 2]);
  });

  it("calls M3 traffic and physics when playing", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    let trafficCalled = false;
    let physicsCalled = false;
    const m3: M3Proxy = {
      traffic: () => {
        trafficCalled = true;
        return { npcCars: [], botControls: [], travelTimes: [], trafficMetrics: { npcCount: 0, meanNpcSpeed: 0, botRouteChanges: 0 } };
      },
      physics: () => {
        physicsCalled = true;
        return { poses: Array.from({ length: MAX_PLAYERS }, () => defaultPose()), collisions: [], falls: [] };
      },
    };
    runTick(world, emptyTickInput(), new SeededRng(1), deps({ m3 }));
    expect(trafficCalled).toBe(true);
    expect(physicsCalled).toBe(true);
  });

  it("does not call M3 when not playing", () => {
    const world = createInitialWorld();
    world.phase = "lobby";
    let called = false;
    const m3: M3Proxy = {
      traffic: () => { called = true; return { npcCars: [], botControls: [], travelTimes: [], trafficMetrics: { npcCount: 0, meanNpcSpeed: 0, botRouteChanges: 0 } }; },
      physics: () => { called = true; return { poses: [], collisions: [], falls: [] }; },
    };
    runTick(world, emptyTickInput(), new SeededRng(1), deps({ m3 }));
    expect(called).toBe(false);
  });
});

describe("GameLoop.runSync", () => {
  it("runs the exact number of ticks", () => {
    const world = createInitialWorld();
    const loop = new GameLoop(world, new SeededRng(1), deps());
    loop.runSync(100);
    expect(world.tick).toBe(100);
  });

  it("accepts an input provider", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    const inputs: number[] = [];
    const loop = new GameLoop(world, new SeededRng(1), deps());
    loop.runSync(5, (tick) => {
      inputs.push(tick);
      return emptyTickInput();
    });
    expect(inputs).toEqual([0, 1, 2, 3, 4]);
  });
});
