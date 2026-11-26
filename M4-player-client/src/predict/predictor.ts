/**
 * Client-side prediction with server reconciliation.
 *
 * Checkbox mapping (issue #46):
 *   2 — instant button response   → update()
 *   4 — server reconciliation     → onServerState()
 *   5 — lerp / snap               → reconcile()
 *   6 — stop when fallen / paused → update() early-return
 */

import type { BikeState, Control, ServerState } from "./types.js";
import { ControlBuffer } from "./control-buffer.js";
import { stepBike, defaultBikeState } from "./stub-bike.js";

/** Distance threshold: below this we lerp, above we snap. */
const SNAP_THRESHOLD = 3.0;

/** How fast the lerp blend catches up (0..1 per second). */
const BLEND_RATE = 10;

/** Fixed timestep the predictor uses to re-simulate controls. */
const SIM_DT = 1 / 30;

export class Predictor {
  /** The state the player currently sees (predicted + blended). */
  private display: BikeState;

  /** The last authoritative state from the server. */
  private authority: BikeState;

  /** Predicted state before blending (pure sim result). */
  private predicted: BikeState;

  private controls = new ControlBuffer();

  constructor(initial?: BikeState) {
    const start = initial ?? defaultBikeState();
    this.display = { ...start };
    this.authority = { ...start };
    this.predicted = { ...start };
  }

  // ------------------------------------------------------------------
  // Checkbox 2 — instant button response
  // ------------------------------------------------------------------

  /**
   * Call every render frame.
   * Pushes the current input into the control buffer and advances the
   * predicted state so the bike reacts instantly.
   *
   * Returns the Control that should be sent to the server.
   */
  update(
    dt: number,
    throttle: number,
    brake: number,
    steer: number,
  ): Control | null {
    // Checkbox 6 — no prediction while fallen or paused
    if (this.display.fallen || this.display.paused) {
      return null;
    }

    const control = this.controls.add(throttle, brake, steer);

    // advance predicted state
    this.predicted = stepBike(this.predicted, control, dt);

    // blend display toward predicted
    this.display = blendStates(this.display, this.predicted, Math.min(1, BLEND_RATE * dt));

    return control;
  }

  // ------------------------------------------------------------------
  // Checkbox 4 — server reconciliation
  // ------------------------------------------------------------------

  /**
   * Call when a new authoritative state arrives from the server.
   *
   * 1. Accept the server position as ground truth.
   * 2. Drop controls the server has already processed.
   * 3. Re-simulate remaining controls on top of the server state.
   * 4. Decide lerp vs snap (checkbox 5).
   */
  onServerState(server: ServerState): void {
    // store authority
    this.authority = {
      x: server.x,
      z: server.z,
      angle: server.angle,
      speed: server.speed,
      fallen: server.fallen,
      paused: server.paused,
    };

    // acknowledge processed controls
    this.controls.ackUpTo(server.lastSeq);

    // re-simulate unacknowledged controls on top of authority
    // (skip re-simulation if the server says we're fallen or paused)
    let simState: BikeState = { ...this.authority };
    if (!this.authority.fallen && !this.authority.paused) {
      for (const ctrl of this.controls.pending()) {
        simState = stepBike(simState, ctrl, SIM_DT);
      }
    }

    // Checkbox 5 — reconcile (lerp or snap)
    this.predicted = simState;
    this.reconcile();
  }

  // ------------------------------------------------------------------
  // Checkbox 5 — lerp / snap
  // ------------------------------------------------------------------

  private reconcile(): void {
    const dx = this.predicted.x - this.display.x;
    const dz = this.predicted.z - this.display.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > SNAP_THRESHOLD || this.authority.fallen || this.authority.paused) {
      // large error, crash, or pause → snap immediately
      this.display = { ...this.predicted };
    }
    // else: display will smoothly blend toward predicted in update()
  }

  // ------------------------------------------------------------------
  // Checkbox 6 — stop when fallen / paused
  // ------------------------------------------------------------------

  /** External notification that the bike fell or the game paused. */
  setFallen(fallen: boolean): void {
    this.display.fallen = fallen;
    this.predicted.fallen = fallen;
  }

  setPaused(paused: boolean): void {
    this.display.paused = paused;
    this.predicted.paused = paused;
  }

  // ------------------------------------------------------------------
  // Accessors
  // ------------------------------------------------------------------

  /** The state to render on screen. */
  getDisplayState(): Readonly<BikeState> {
    return this.display;
  }

  /** How many controls are waiting for server acknowledgement. */
  get pendingControlCount(): number {
    return this.controls.length;
  }

  /** Reset everything (e.g. on reconnect). */
  reset(state?: BikeState): void {
    const s = state ?? defaultBikeState();
    this.display = { ...s };
    this.authority = { ...s };
    this.predicted = { ...s };
    this.controls.clear();
  }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function blendStates(a: BikeState, b: BikeState, t: number): BikeState {
  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    angle: lerpAngle(a.angle, b.angle, t),
    speed: lerp(a.speed, b.speed, t),
    fallen: b.fallen,
    paused: b.paused,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  // wrap to -PI..PI
  diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
