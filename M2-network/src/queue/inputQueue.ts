import type { Checked } from "../codec/checker.js";
import type { PlayerEvents } from "../session/types.js";
import { emptyTickInput, type AdminCommand, type BoardEvent, type TickInput } from "./types.js";

/** 8 phones × 60 messages per second is 480; this is several seconds of all of them. */
const MAX_WAITING_CONTROLS = 2048;

/**
 * Input queue (M2-2, v2.1 section 6.5).
 *
 * Between two ticks M2 only collects. Checked inputs wait here, and M1 takes all of them
 * at the start of the next tick with `take()`. Nothing is merged or thrown away here:
 * if two controls of one player come in one tick, both go to M1, which uses the newest
 * one (M1-1 `mergeControls`). A "Find me" is an event, so it is never lost, even when a
 * newer control comes after it in the same tick.
 *
 * The queue is also the `PlayerEvents` of M2-1: joins, lost and returning players go to
 * M1 in the same tick input, in the order they came.
 */
export class InputQueue implements PlayerEvents {
  private pending: TickInput = emptyTickInput();
  /** Inputs taken by M1 so far, by kind (for the demo and the tests). */
  readonly totals = { controls: 0, controlsCut: 0, findMe: 0, joins: 0, lost: 0, returned: 0, adminCommands: 0, boardEvents: 0 };

  /** A message that passed the checker. Returns false for a message that is not a tick input. */
  push(msg: Checked): boolean {
    const f = msg.fields;
    switch (msg.t) {
      case "control":
        if (msg.playerNo === undefined) return false;
        // Only if M1 stops taking (it takes 30 times per second): keep the newest controls.
        // Controls are values, so an old one is worth nothing; events are never cut.
        if (this.pending.controls.length >= MAX_WAITING_CONTROLS) {
          this.pending.controls.shift();
          this.totals.controlsCut++;
        }
        this.pending.controls.push({
          player: msg.playerNo,
          seq: f.seq as number,
          throttle: f.throttle as number,
          brake: f.brake as number,
          steer: f.steer as number,
        });
        this.totals.controls++;
        return true;
      case "find_me":
        if (msg.playerNo === undefined) return false;
        this.pending.findMe.push({ player: msg.playerNo });
        this.totals.findMe++;
        return true;
      case "cmd": {
        const cmd: AdminCommand = { id: f.id as number, name: f.name as string };
        if (f.args && Object.keys(f.args as object).length > 0) cmd.args = f.args as Record<string, unknown>;
        this.pending.adminCommands.push(cmd);
        this.totals.adminCommands++;
        return true;
      }
      default:
        return false;
    }
  }

  // ---- PlayerEvents of M2-1 ----

  join(e: { playerKey: string; playerNo: number; name: string; team: number }): void {
    this.pending.joins.push({ playerKey: e.playerKey, name: e.name, team: e.team, playerNo: e.playerNo });
    this.totals.joins++;
  }

  lost(e: { playerKey: string; playerNo: number }): void {
    this.pending.disconnects.push({ playerKey: e.playerKey, playerNo: e.playerNo });
    this.totals.lost++;
  }

  returned(e: { playerKey: string; playerNo: number }): void {
    this.pending.reconnects.push({ playerKey: e.playerKey, playerNo: e.playerNo });
    this.totals.returned++;
  }

  /** An earthquake event from the board (M2-4 calls this). */
  boardEvent(e: BoardEvent): void {
    this.pending.boardEvents.push({ ...e });
    this.totals.boardEvents++;
  }

  /** M1 at the start of a tick: every input since the last call, and an empty queue after it. */
  take(): TickInput {
    const out = this.pending;
    this.pending = emptyTickInput();
    return out;
  }

  /** Inputs waiting now (for tests and the demo). */
  get size(): number {
    const p = this.pending;
    return p.controls.length + p.findMe.length + p.joins.length + p.disconnects.length +
      p.reconnects.length + p.adminCommands.length + p.boardEvents.length;
  }
}
