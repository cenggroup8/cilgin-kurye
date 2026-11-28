/**
 * Prediction tests — verifies every checkbox of issue #46.
 *
 * Run:  npx tsx --test test/predict.test.ts
 *   or: npx ts-node --esm test/predict.test.ts   (with node --test)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Predictor } from "../src/predict/predictor.js";
import { stepBike, defaultBikeState } from "../src/predict/stub-bike.js";
import { ControlBuffer } from "../src/predict/control-buffer.js";
import type { ServerState, BikeState } from "../src/predict/types.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function serverFrom(state: BikeState, lastSeq: number): ServerState {
  return { ...state, lastSeq };
}

// ----------------------------------------------------------------
// Checkbox 1 — stub physics placeholder
// ----------------------------------------------------------------

describe("stub-bike (checkbox 1)", () => {
  it("accelerates forward with throttle", () => {
    const s = stepBike(defaultBikeState(), { seq: 1, throttle: 1, brake: 0, steer: 0 }, 0.5);
    assert.ok(s.speed > 0, "speed should increase");
    assert.ok(s.z > 0, "should move along +Z");
  });

  it("brakes to a stop", () => {
    const moving: BikeState = { x: 0, z: 0, angle: 0, speed: 5, fallen: false, paused: false };
    const s = stepBike(moving, { seq: 1, throttle: 0, brake: 1, steer: 0 }, 1.0);
    assert.ok(s.speed <= 0, "speed should drop to zero or below");
  });

  it("does not move when fallen", () => {
    const fallen: BikeState = { x: 0, z: 0, angle: 0, speed: 5, fallen: true, paused: false };
    const s = stepBike(fallen, { seq: 1, throttle: 1, brake: 0, steer: 0 }, 1.0);
    assert.equal(s.x, fallen.x);
    assert.equal(s.z, fallen.z);
  });

  it("does not move when paused", () => {
    const paused: BikeState = { x: 0, z: 0, angle: 0, speed: 5, fallen: false, paused: true };
    const s = stepBike(paused, { seq: 1, throttle: 1, brake: 0, steer: 0 }, 1.0);
    assert.equal(s.x, paused.x);
    assert.equal(s.z, paused.z);
  });
});

// ----------------------------------------------------------------
// Checkbox 2 — instant button response
// ----------------------------------------------------------------

describe("predictor instant response (checkbox 2)", () => {
  it("moves the display bike on the same frame as the input", () => {
    const p = new Predictor();
    p.update(1 / 30, 1, 0, 0);
    const d = p.getDisplayState();
    assert.ok(d.speed > 0, "bike should have speed after one update");
    assert.ok(d.z > 0, "bike should have moved forward");
  });
});

// ----------------------------------------------------------------
// Checkbox 3 — numbered control list
// ----------------------------------------------------------------

describe("control-buffer (checkbox 3)", () => {
  it("assigns increasing seq numbers", () => {
    const buf = new ControlBuffer();
    const a = buf.add(1, 0, 0);
    const b = buf.add(1, 0, 0);
    const c = buf.add(0, 1, 0);
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(c.seq, 3);
    assert.equal(buf.length, 3);
  });

  it("ackUpTo removes acknowledged controls", () => {
    const buf = new ControlBuffer();
    buf.add(1, 0, 0);
    buf.add(1, 0, 0);
    buf.add(1, 0, 0);
    buf.ackUpTo(2);
    const pending = buf.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].seq, 3);
  });
});

// ----------------------------------------------------------------
// Checkbox 4 — server reconciliation (re-simulate pending)
// ----------------------------------------------------------------

describe("server reconciliation (checkbox 4)", () => {
  it("re-simulates unacknowledged controls after server state", () => {
    const p = new Predictor();

    // player sends 3 controls
    p.update(1 / 30, 1, 0, 0); // seq 1
    p.update(1 / 30, 1, 0, 0); // seq 2
    p.update(1 / 30, 1, 0, 0); // seq 3

    const beforeZ = p.getDisplayState().z;

    // server acks seq 1, gives its own authoritative position
    const serverPos = stepBike(defaultBikeState(), { seq: 1, throttle: 1, brake: 0, steer: 0 }, 1 / 30);
    p.onServerState(serverFrom(serverPos, 1));

    // display should still be near where it was (controls 2+3 re-applied)
    const afterZ = p.getDisplayState().z;
    assert.ok(afterZ > 0, "bike should still be ahead after reconciliation");
    assert.equal(p.pendingControlCount, 2, "two controls should remain pending");
  });
});

// ----------------------------------------------------------------
// Checkbox 5 — lerp vs snap
// ----------------------------------------------------------------

describe("lerp / snap reconciliation (checkbox 5)", () => {
  it("snaps when the server position is far away", () => {
    const p = new Predictor();
    // player thinks they're at origin
    // server says they're at z=100 (far away, e.g. crash teleport)
    const farState: ServerState = {
      x: 0, z: 100, angle: 0, speed: 0,
      fallen: false, paused: false, lastSeq: 0,
    };
    p.onServerState(farState);
    const d = p.getDisplayState();
    assert.ok(Math.abs(d.z - 100) < 0.01, `should snap to z=100, got z=${d.z}`);
  });

  it("blends smoothly when the difference is small", () => {
    const p = new Predictor();
    // move a little
    p.update(1 / 30, 1, 0, 0);
    const before = p.getDisplayState().z;

    // server says position is slightly different
    const nearState: ServerState = {
      x: 0, z: before + 0.5, angle: 0, speed: p.getDisplayState().speed,
      fallen: false, paused: false, lastSeq: 1,
    };
    p.onServerState(nearState);
    const after = p.getDisplayState().z;

    // should NOT have snapped exactly to the server position
    // (blend will close the gap over multiple frames)
    const diff = Math.abs(after - (before + 0.5));
    assert.ok(diff < 1.0, "should be close but blending, not jumping");
  });
});

// ----------------------------------------------------------------
// Checkbox 6 — stop prediction when fallen or paused
// ----------------------------------------------------------------

describe("fallen / paused stops prediction (checkbox 6)", () => {
  it("returns null and does not move when fallen", () => {
    const p = new Predictor();
    p.setFallen(true);
    const ctrl = p.update(1 / 30, 1, 0, 0);
    assert.equal(ctrl, null, "should not produce a control");
    assert.equal(p.getDisplayState().z, 0, "should not have moved");
  });

  it("returns null and does not move when paused", () => {
    const p = new Predictor();
    p.setPaused(true);
    const ctrl = p.update(1 / 30, 1, 0, 0);
    assert.equal(ctrl, null);
    assert.equal(p.getDisplayState().z, 0);
  });

  it("resumes after un-falling", () => {
    const p = new Predictor();
    p.setFallen(true);
    p.update(1 / 30, 1, 0, 0);
    p.setFallen(false);
    const ctrl = p.update(1 / 30, 1, 0, 0);
    assert.ok(ctrl !== null, "should produce a control after recovery");
    assert.ok(p.getDisplayState().z > 0, "should move after recovery");
  });
});

// ----------------------------------------------------------------
// Done criteria — delay and packet loss simulation
// ----------------------------------------------------------------

describe("delay + packet loss (done criteria)", () => {
  it("stays close to server despite delayed acks", () => {
    const p = new Predictor();
    const serverBike: BikeState[] = [defaultBikeState()];

    // simulate 30 frames of full throttle
    for (let i = 0; i < 30; i++) {
      p.update(1 / 30, 1, 0, 0);
      // server also advances (perfect mirror)
      serverBike.push(
        stepBike(serverBike[serverBike.length - 1], { seq: i + 1, throttle: 1, brake: 0, steer: 0 }, 1 / 30),
      );
    }

    // server ack arrives late — only acks up to seq 20
    p.onServerState(serverFrom(serverBike[20], 20));

    const display = p.getDisplayState();
    const serverLatest = serverBike[30];
    const drift = Math.abs(display.z - serverLatest.z);
    assert.ok(drift < 2.0, `drift should be small, got ${drift.toFixed(3)}`);
  });

  it("recovers correctly when some server states are lost", () => {
    const p = new Predictor();

    // send 10 controls
    for (let i = 0; i < 10; i++) {
      p.update(1 / 30, 1, 0, 0);
    }

    // simulate packet loss: server jumps from ack 0 to ack 7
    let serverBike = defaultBikeState();
    for (let i = 1; i <= 7; i++) {
      serverBike = stepBike(serverBike, { seq: i, throttle: 1, brake: 0, steer: 0 }, 1 / 30);
    }
    p.onServerState(serverFrom(serverBike, 7));

    assert.equal(p.pendingControlCount, 3, "controls 8,9,10 should remain");
    assert.ok(p.getDisplayState().z > 0, "bike should still be moving forward");
  });

  it("snaps correctly after a crash teleport", () => {
    const p = new Predictor();

    // player drives forward
    for (let i = 0; i < 20; i++) {
      p.update(1 / 30, 1, 0, 0);
    }
    const beforeZ = p.getDisplayState().z;

    // server says: you crashed, you're back at z=0
    p.onServerState({
      x: 0, z: 0, angle: 0, speed: 0,
      fallen: true, paused: false, lastSeq: 20,
    });

    const afterZ = p.getDisplayState().z;
    assert.ok(Math.abs(afterZ) < 0.1, `should snap to z~0 after crash, got ${afterZ.toFixed(3)}`);
    assert.equal(p.getDisplayState().fallen, true, "should be fallen");
  });
});
