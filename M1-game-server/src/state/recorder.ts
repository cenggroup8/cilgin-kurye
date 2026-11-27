// Oyun kaydı (M1-1, plan 3.5).
// Tick başına bir NDJSON satırı. Kayıttan oyunu yeniden oynatma.
// İlk satır: { type: "header", seed, tickRate, version }
// Sonraki satırlar: { type: "tick", tick, input }

import type { PostTickHook } from "../loop/tick.js";
import type { TickInput } from "../loop/types.js";
import type { WorldState } from "./world.js";
import { TICK_RATE } from "./world.js";

export interface RecordHeader {
  type: "header";
  seed: number;
  tickRate: number;
  version: number;
}

export interface RecordEntry {
  type: "tick";
  tick: number;
  input: TickInput;
}

export type RecordLine = RecordHeader | RecordEntry;

export class GameRecorder implements PostTickHook {
  readonly lines: string[] = [];

  constructor(seed: number) {
    const header: RecordHeader = { type: "header", seed, tickRate: TICK_RATE, version: 1 };
    this.lines.push(JSON.stringify(header));
  }

  afterTick(world: Readonly<WorldState>, input: TickInput): void {
    const entry: RecordEntry = { type: "tick", tick: world.tick, input };
    this.lines.push(JSON.stringify(entry));
  }

  toNdjson(): string {
    return this.lines.join("\n") + "\n";
  }
}

/** Parse an NDJSON recording back into header + entries. */
export function parseRecording(ndjson: string): { header: RecordHeader; entries: RecordEntry[] } {
  const lines = ndjson.trim().split("\n");
  if (lines.length === 0) throw new Error("empty recording");

  const header = JSON.parse(lines[0]!) as RecordHeader;
  if (header.type !== "header") throw new Error("first line must be a header");

  const entries: RecordEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]!) as RecordEntry;
    entries.push(entry);
  }

  return { header, entries };
}
