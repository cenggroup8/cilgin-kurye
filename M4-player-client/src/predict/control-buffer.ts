/**
 * Numbered control buffer.
 *
 * Every control the player sends gets a monotonically increasing seq number.
 * When the server acknowledges up to a certain seq, we drop the acknowledged
 * entries and keep only the ones that still need to be re-simulated.
 */

import type { Control } from "./types.js";

export class ControlBuffer {
  private buf: Control[] = [];
  private nextSeq = 1;

  /** Push a new control and return its assigned seq. */
  add(throttle: number, brake: number, steer: number): Control {
    const control: Control = {
      seq: this.nextSeq++,
      throttle,
      brake,
      steer,
    };
    this.buf.push(control);
    return control;
  }

  /** Drop every control whose seq <= ackedSeq (server already applied them). */
  ackUpTo(ackedSeq: number): void {
    this.buf = this.buf.filter((c) => c.seq > ackedSeq);
  }

  /** Return the controls that the server has NOT yet acknowledged. */
  pending(): readonly Control[] {
    return this.buf;
  }

  /** Number of unacknowledged controls. */
  get length(): number {
    return this.buf.length;
  }

  /** Reset the buffer (e.g. on reconnect). */
  clear(): void {
    this.buf = [];
  }
}
