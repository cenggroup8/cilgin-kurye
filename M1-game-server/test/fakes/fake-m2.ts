// Sahte M2 (M1-1): senaryo dosyasından girdi verir, çıktıları toplar.

import type { AdminCommand } from "../../src/admin/admin.js";
import type {
  BoardEvent,
  ControlInput,
  DisconnectInput,
  FindMeInput,
  JoinInput,
  ReconnectInput,
  TickInput,
} from "../../src/loop/types.js";
import { emptyTickInput } from "../../src/loop/types.js";

export interface ScenarioEntry {
  tick: number;
  controls?: ControlInput[];
  findMe?: FindMeInput[];
  joins?: JoinInput[];
  disconnects?: DisconnectInput[];
  reconnects?: ReconnectInput[];
  adminCommands?: AdminCommand[];
  boardEvents?: BoardEvent[];
}

export interface FakeM2Options {
  entries: ScenarioEntry[];
}

export class FakeM2 {
  private readonly byTick = new Map<number, ScenarioEntry[]>();
  readonly collectedStates: unknown[] = [];

  constructor(opts: FakeM2Options) {
    for (const e of opts.entries) {
      const list = this.byTick.get(e.tick) ?? [];
      list.push(e);
      this.byTick.set(e.tick, list);
    }
  }

  /** InputProvider for GameLoop: returns the TickInput for the given tick. */
  inputForTick(tick: number): TickInput {
    const entries = this.byTick.get(tick);
    if (!entries) return emptyTickInput();

    const input = emptyTickInput();
    for (const e of entries) {
      if (e.controls) input.controls.push(...e.controls);
      if (e.findMe) input.findMe.push(...e.findMe);
      if (e.joins) input.joins.push(...e.joins);
      if (e.disconnects) input.disconnects.push(...e.disconnects);
      if (e.reconnects) input.reconnects.push(...e.reconnects);
      if (e.adminCommands) input.adminCommands.push(...e.adminCommands);
      if (e.boardEvents) input.boardEvents.push(...e.boardEvents);
    }
    return input;
  }

  /** Convenience: returns a bound function for GameLoop inputProvider. */
  provider(): (tick: number) => TickInput {
    return (tick) => this.inputForTick(tick);
  }
}
