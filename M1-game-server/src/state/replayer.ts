// Kayıttan oynatma (M1-1).
// NDJSON kaydını okur, seed'i alır, her satırı bir tick girdisi olarak besler.

import { SeededRng } from "../loop/rng.js";
import { GameLoop } from "../loop/game-loop.js";
import type { TickDeps } from "../loop/tick.js";
import { emptyTickInput } from "../loop/types.js";
import { createInitialWorld, type WorldState } from "./world.js";
import { parseRecording, type RecordEntry } from "./recorder.js";

export interface ReplayResult {
  world: WorldState;
  seed: number;
  ticksPlayed: number;
}

export function replayFromNdjson(ndjson: string, deps: TickDeps): ReplayResult {
  const { header, entries } = parseRecording(ndjson);
  return replayEntries(header.seed, entries, deps);
}

export function replayEntries(
  seed: number,
  entries: readonly RecordEntry[],
  deps: TickDeps,
): ReplayResult {
  const world = createInitialWorld();
  const rng = new SeededRng(seed);
  const loop = new GameLoop(world, rng, deps);

  const byTick = new Map<number, RecordEntry>();
  for (const e of entries) byTick.set(e.tick, e);

  loop.runSync(entries.length, (tick) => {
    const entry = byTick.get(tick + 1); // entries are 1-indexed (after tick++)
    return entry?.input ?? emptyTickInput();
  });

  return { world, seed, ticksPlayed: entries.length };
}
