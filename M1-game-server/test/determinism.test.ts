// Kabul testleri (M1-1):
// 1. Boş kurallarla 5 dakikalık bir oyun baştan sona döner.
// 2. Aynı seed ve aynı girdiler iki çalıştırmada birebir aynı son durumu verir.
// 3. Kayıttan oynatma (replay) da birebir aynı son durumu verir.

import { describe, expect, it } from "vitest";
import { SeededRng } from "../src/loop/rng.js";
import { GameLoop } from "../src/loop/game-loop.js";
import {
  noopAdmin,
  noopDelivery,
  noopHazards,
  noopMatch,
  type M3Proxy,
  type TickDeps,
  type PostTickHook,
} from "../src/loop/tick.js";
import { emptyTickInput, type PhysicsOutput, type TickInput, type TrafficOutput } from "../src/loop/types.js";
import {
  createInitialWorld,
  COUNTDOWN_TICKS,
  defaultPose,
  MATCH_DURATION_TICKS,
  MAX_PLAYERS,
  TICK_RATE,
  type WorldState,
} from "../src/state/world.js";
import { buildGameState, type GameState } from "../src/state/state-builder.js";
import { GameRecorder, parseRecording } from "../src/state/recorder.js";
import { FakeM2, type ScenarioEntry } from "./fakes/fake-m2.js";
import { createFakeM3 } from "./fakes/fake-m3.js";

function stubM3(): M3Proxy {
  return createFakeM3();
}

function makeDeps(hooks: PostTickHook[] = []): TickDeps {
  return {
    admin: noopAdmin,
    match: noopMatch,
    delivery: noopDelivery,
    hazards: noopHazards,
    m3: stubM3(),
    hooks,
  };
}

/** Build a scenario that starts the game and runs 5 minutes. */
function fiveMinScenario(): ScenarioEntry[] {
  const entries: ScenarioEntry[] = [];

  // Tick 1: start command → triggers countdown
  entries.push({
    tick: 0,
    adminCommands: [{ id: 1, name: "start" }],
  });

  // Some controls during the game
  for (let t = 0; t < 9000; t += 30) {
    entries.push({
      tick: COUNTDOWN_TICKS + t + 5,
      controls: [{ player: 0, seq: t + 1, throttle: 0.8, brake: 0, steer: 0.1 }],
    });
  }

  return entries;
}

/** Runs a full game and returns final world state + recording. */
function runFullGame(seed: number, scenarioEntries: ScenarioEntry[]): {
  world: WorldState;
  gameState: GameState;
  ndjson: string;
} {
  const world = createInitialWorld();
  const rng = new SeededRng(seed);
  const recorder = new GameRecorder(seed);
  const fakeM2 = new FakeM2({ entries: scenarioEntries });

  // A simple match step that handles start command to transition phases
  const simpleMatch = {
    update(w: WorldState, input: TickInput) {
      for (const cmd of input.adminCommands) {
        if (cmd.name === "start" && w.phase === "lobby") {
          w.phase = "countdown";
          w.countdownTicks = COUNTDOWN_TICKS;
        } else if (cmd.name === "pause" && w.phase === "playing") {
          w.phase = "paused";
        } else if (cmd.name === "resume" && w.phase === "paused") {
          w.phase = "playing";
        } else if (cmd.name === "end" && (w.phase === "playing" || w.phase === "paused")) {
          w.phase = "ended";
        }
      }
    },
  };

  const deps = makeDeps([recorder]);
  deps.match = simpleMatch;

  const loop = new GameLoop(world, rng, deps);

  // Run enough ticks for countdown + 5 min + some margin
  const totalTicks = COUNTDOWN_TICKS + MATCH_DURATION_TICKS + 10;
  loop.runSync(totalTicks, (tick) => fakeM2.inputForTick(tick));

  return {
    world,
    gameState: buildGameState(world),
    ndjson: recorder.toNdjson(),
  };
}

describe("5-minute game acceptance", () => {
  const SEED = 20261127;

  it("runs a 5-minute game from start to end without errors", () => {
    const scenario = fiveMinScenario();
    const { world, gameState } = runFullGame(SEED, scenario);

    expect(world.phase).toBe("ended");
    expect(world.gameTimeTicks).toBe(MATCH_DURATION_TICKS);
    expect(gameState.remainingSeconds).toBe(0);
    expect(world.tick).toBeGreaterThan(COUNTDOWN_TICKS + MATCH_DURATION_TICKS);
  });

  it("same seed + same inputs → identical final state (determinism)", () => {
    const scenario = fiveMinScenario();
    const run1 = runFullGame(SEED, scenario);
    const run2 = runFullGame(SEED, scenario);

    // Compare full world state as JSON
    expect(worldSnapshot(run1.world)).toBe(worldSnapshot(run2.world));
  });

  it("replay from recording produces identical final state", () => {
    const scenario = fiveMinScenario();
    const original = runFullGame(SEED, scenario);

    // Replay from the recording
    const { header, entries } = parseRecording(original.ndjson);
    expect(header.seed).toBe(SEED);

    const replayWorld = createInitialWorld();
    const replayRng = new SeededRng(header.seed);

    const simpleMatch = {
      update(w: WorldState, input: TickInput) {
        for (const cmd of input.adminCommands) {
          if (cmd.name === "start" && w.phase === "lobby") {
            w.phase = "countdown";
            w.countdownTicks = COUNTDOWN_TICKS;
          } else if (cmd.name === "pause" && w.phase === "playing") {
            w.phase = "paused";
          } else if (cmd.name === "resume" && w.phase === "paused") {
            w.phase = "playing";
          } else if (cmd.name === "end" && (w.phase === "playing" || w.phase === "paused")) {
            w.phase = "ended";
          }
        }
      },
    };

    const replayDeps = makeDeps();
    replayDeps.match = simpleMatch;
    const replayLoop = new GameLoop(replayWorld, replayRng, replayDeps);

    // Build a tick→input map from the recording entries
    const inputByTick = new Map<number, TickInput>();
    for (const e of entries) inputByTick.set(e.tick, e.input);

    replayLoop.runSync(entries.length, (tick) => {
      // Entries are recorded after tick++ so entry.tick = tick+1
      return inputByTick.get(tick + 1) ?? emptyTickInput();
    });

    expect(worldSnapshot(replayWorld)).toBe(worldSnapshot(original.world));
  });
});

/** Serializes world state for comparison (excludes non-deterministic fields). */
function worldSnapshot(w: WorldState): string {
  return JSON.stringify({
    tick: w.tick,
    phase: w.phase,
    gameTimeTicks: w.gameTimeTicks,
    countdownTicks: w.countdownTicks,
    controls: w.controls,
    poses: w.poses,
    deliveries: w.deliveries,
    scores: w.scores,
    penaltyTicks: w.penaltyTicks,
    obstacles: w.obstacles,
    obstacleVersion: w.obstacleVersion,
    quake: w.quake,
    npcCars: w.npcCars,
  });
}
