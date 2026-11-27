import assert from "node:assert/strict";
import { test } from "node:test";
import { compassAngle, MIN_TARGET_DISTANCE_M } from "../../../src/screens/hud/compass-model.ts";

function close(actual: number | null, expected: number, message = ""): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${message} beklenen ${expected}, gelen ${actual}`);
}

// Rule of contracts: x east, z south, heading in degrees clockwise from north.
// So north is -z, east is +x, south is +z, west is -x.
const ORIGIN = { x: 100, z: 100 };
const north = { x: 100, z: 50 };
const east = { x: 150, z: 100 };
const south = { x: 100, z: 150 };
const west = { x: 50, z: 100 };

test("looking north: a target to the north is ahead, east is right, west is left, south is behind", () => {
  const self = { ...ORIGIN, headingDeg: 0 };
  close(compassAngle(self, north), 0, "kuzey");
  close(compassAngle(self, east), 90, "doğu");
  close(compassAngle(self, west), -90, "batı");
  close(compassAngle(self, south), -180, "güney");
});

test("the arrow turns with the heading of the player", () => {
  close(compassAngle({ ...ORIGIN, headingDeg: 90 }, east), 0, "doğuya bakıp doğuya");
  close(compassAngle({ ...ORIGIN, headingDeg: 90 }, north), -90, "doğuya bakıp kuzeye");
  close(compassAngle({ ...ORIGIN, headingDeg: 180 }, south), 0, "güneye bakıp güneye");
  close(compassAngle({ ...ORIGIN, headingDeg: 270 }, north), 90, "batıya bakıp kuzeye");
});

test("a target straight ahead is 0 and a target straight behind is -180 for every heading", () => {
  for (const headingDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const rad = (headingDeg * Math.PI) / 180;
    // One step ahead: east part sin(heading), north part cos(heading), and north is -z.
    const ahead = { x: 100 + 50 * Math.sin(rad), z: 100 - 50 * Math.cos(rad) };
    const behind = { x: 100 - 50 * Math.sin(rad), z: 100 + 50 * Math.cos(rad) };
    close(compassAngle({ ...ORIGIN, headingDeg }, ahead), 0, `önde ${headingDeg}`);
    const back = compassAngle({ ...ORIGIN, headingDeg }, behind);
    assert.ok(back !== null && Math.abs(Math.abs(back) - 180) < 1e-9, `arkada ${headingDeg}: ${back}`);
  }
});

test("the answer is always in [-180, 180): exactly behind is -180, never +180", () => {
  const self = { ...ORIGIN, headingDeg: 0 };
  assert.equal(compassAngle(self, south), -180);
  for (let headingDeg = -720; headingDeg <= 720; headingDeg += 17) {
    for (const target of [north, east, south, west, { x: 130, z: 20 }]) {
      const angle = compassAngle({ ...ORIGIN, headingDeg }, target);
      assert.ok(angle !== null && angle >= -180 && angle < 180, `${headingDeg}: ${angle}`);
    }
  }
});

test("the turn is the short way across north: heading 350 and target 10 degrees is +20, not -340", () => {
  const t10 = { x: 100 + 100 * Math.sin((10 * Math.PI) / 180), z: 100 - 100 * Math.cos((10 * Math.PI) / 180) };
  const t350 = { x: 100 + 100 * Math.sin((350 * Math.PI) / 180), z: 100 - 100 * Math.cos((350 * Math.PI) / 180) };
  close(compassAngle({ ...ORIGIN, headingDeg: 350 }, t10), 20, "350 -> 10");
  close(compassAngle({ ...ORIGIN, headingDeg: 10 }, t350), -20, "10 -> 350");
});

test("a heading outside 0-360 is read the same way", () => {
  close(compassAngle({ ...ORIGIN, headingDeg: 360 }, east), 90);
  close(compassAngle({ ...ORIGIN, headingDeg: -90 }, west), 0);
  close(compassAngle({ ...ORIGIN, headingDeg: 450 }, east), 0);
});

test("a target closer than 1 m gives no arrow, one metre away gives one", () => {
  const self = { ...ORIGIN, headingDeg: 0 };
  assert.equal(MIN_TARGET_DISTANCE_M, 1);
  assert.equal(compassAngle(self, ORIGIN), null);
  assert.equal(compassAngle(self, { x: 100, z: 99.5 }), null);
  assert.equal(compassAngle(self, { x: 100.99, z: 100 }), null);
  close(compassAngle(self, { x: 100, z: 99 }), 0, "tam 1 m");
});

test("a number that is not finite gives no arrow", () => {
  const self = { ...ORIGIN, headingDeg: 0 };
  assert.equal(compassAngle({ ...self, x: Number.NaN }, north), null);
  assert.equal(compassAngle({ ...self, z: Infinity }, north), null);
  assert.equal(compassAngle({ ...self, headingDeg: Number.NaN }, north), null);
  assert.equal(compassAngle(self, { x: Number.NaN, z: 50 }), null);
  assert.equal(compassAngle(self, { x: 100, z: -Infinity }), null);
});

test("the answer is only a direction: a far target and a near one give the same angle", () => {
  const self = { ...ORIGIN, headingDeg: 30 };
  close(compassAngle(self, { x: 120, z: 60 }), compassAngle(self, { x: 140, z: 20 })!);
});
