// M1-1 demo: senaryoyu çalıştırır, olayları yazar.
// Run: npx tsx test/scenarios/match-demo.ts

import { readFileSync } from "node:fs";
import { SeededRng } from "../../src/loop/rng.js";
import { GameLoop } from "../../src/loop/game-loop.js";
import {
  noopAdmin,
  noopDelivery,
  noopHazards,
  type PostTickHook,
  type TickDeps,
} from "../../src/loop/tick.js";
import type { TickInput } from "../../src/loop/types.js";
import {
  createInitialWorld,
  COUNTDOWN_TICKS,
  MATCH_DURATION_TICKS,
  TICK_RATE,
  type WorldState,
} from "../../src/state/world.js";
import { buildGameState } from "../../src/state/state-builder.js";
import { GameRecorder, parseRecording } from "../../src/state/recorder.js";
import { FakeM2, type ScenarioEntry } from "../fakes/fake-m2.js";
import { createFakeM3 } from "../fakes/fake-m3.js";

// ── Load scenario ──────────────────────────────────────────────────

const scenarioPath = new URL("five-min.json", import.meta.url);
const scenarioData = JSON.parse(readFileSync(scenarioPath, "utf-8")) as {
  seed: number;
  entries: ScenarioEntry[];
};

const SEED = scenarioData.seed;
const fakeM2 = new FakeM2({ entries: scenarioData.entries });

// ── Event logger ───────────────────────────────────────────────────

let lastPhase = "lobby";
const eventLog: PostTickHook = {
  afterTick(world: Readonly<WorldState>, input: TickInput) {
    const t = world.tick;
    const sec = (world.gameTimeTicks / TICK_RATE).toFixed(1);

    if (world.phase !== lastPhase) {
      console.log(`[tick ${t}] phase: ${lastPhase} → ${world.phase}`);
      lastPhase = world.phase;
    }

    if (input.joins.length > 0) {
      for (const j of input.joins) {
        console.log(`[tick ${t}] join: ${j.name} (team ${j.team})`);
      }
    }

    if (input.adminCommands.length > 0) {
      for (const c of input.adminCommands) {
        console.log(`[tick ${t}] admin: ${c.name} ${c.args ? JSON.stringify(c.args) : ""}`);
      }
    }

    if (input.boardEvents.length > 0) {
      for (const e of input.boardEvents) {
        console.log(`[tick ${t}] board: ${e.source} magnitude=${e.magnitude} zone=${e.zone}`);
      }
    }

    if (input.findMe.length > 0) {
      for (const f of input.findMe) {
        console.log(`[tick ${t}] find-me: player ${f.player}`);
      }
    }

    // Log game time every 30 seconds
    if (world.phase === "playing" && world.gameTimeTicks > 0 && world.gameTimeTicks % (30 * TICK_RATE) === 0) {
      console.log(`[tick ${t}] game time: ${sec}s`);
    }
  },
};

// ── Simple match step ──────────────────────────────────────────────

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

// ── Run ────────────────────────────────────────────────────────────

console.log(`=== M1-1 Demo: seed=${SEED} ===\n`);

const recorder = new GameRecorder(SEED);
const deps: TickDeps = {
  admin: noopAdmin,
  match: simpleMatch,
  delivery: noopDelivery,
  hazards: noopHazards,
  m3: createFakeM3(),
  hooks: [recorder, eventLog],
};

const world = createInitialWorld();
const rng = new SeededRng(SEED);
const loop = new GameLoop(world, rng, deps);

// Extra margin for pauses (game time stops during pause, but ticks continue)
const totalTicks = COUNTDOWN_TICKS + MATCH_DURATION_TICKS + 100;
loop.runSync(totalTicks, (tick) => fakeM2.inputForTick(tick));

const gs = buildGameState(world);
console.log(`\n=== Final state ===`);
console.log(`phase: ${gs.phase}`);
console.log(`ticks: ${world.tick}`);
console.log(`game time: ${gs.gameTimeSeconds.toFixed(1)}s`);
console.log(`scores: ${gs.scores.map((s) => `team${s.team}=${s.score}`).join(", ")}`);
console.log(`recording: ${recorder.lines.length} lines`);

// ── Determinism check ──────────────────────────────────────────────

console.log(`\n=== Determinism check: running again with same seed ===`);

const recorder2 = new GameRecorder(SEED);
const deps2: TickDeps = { ...deps, hooks: [recorder2] };
const world2 = createInitialWorld();
const rng2 = new SeededRng(SEED);
const fakeM2b = new FakeM2({ entries: scenarioData.entries });
const loop2 = new GameLoop(world2, rng2, deps2);
loop2.runSync(totalTicks, (tick) => fakeM2b.inputForTick(tick));

const snap1 = JSON.stringify({ tick: world.tick, phase: world.phase, gt: world.gameTimeTicks, scores: world.scores, controls: world.controls, poses: world.poses });
const snap2 = JSON.stringify({ tick: world2.tick, phase: world2.phase, gt: world2.gameTimeTicks, scores: world2.scores, controls: world2.controls, poses: world2.poses });

if (snap1 === snap2) {
  console.log("PASS: identical final state");
} else {
  console.error("FAIL: states differ!");
  process.exitCode = 1;
}

// ── Replay check ───────────────────────────────────────────────────

console.log(`\n=== Replay check ===`);

const { header, entries } = parseRecording(recorder.toNdjson());
const world3 = createInitialWorld();
const rng3 = new SeededRng(header.seed);
const deps3: TickDeps = { ...deps, hooks: [] };
const loop3 = new GameLoop(world3, rng3, deps3);

const inputByTick = new Map<number, TickInput>();
for (const e of entries) inputByTick.set(e.tick, e.input);

loop3.runSync(entries.length, (tick) => {
  return inputByTick.get(tick + 1) ?? { controls: [], findMe: [], joins: [], disconnects: [], reconnects: [], adminCommands: [], boardEvents: [] };
});

const snap3 = JSON.stringify({ tick: world3.tick, phase: world3.phase, gt: world3.gameTimeTicks, scores: world3.scores, controls: world3.controls, poses: world3.poses });

if (snap1 === snap3) {
  console.log("PASS: replay produces identical final state");
} else {
  console.error("FAIL: replay state differs!");
  process.exitCode = 1;
}

console.log("\nDone.");
