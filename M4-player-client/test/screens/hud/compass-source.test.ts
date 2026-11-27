import assert from "node:assert/strict";
import { test } from "node:test";
import { compassAngle } from "../../../src/screens/hud/compass-model.ts";
import {
  fromM1Pose,
  fromM3Pose,
  fromM3Target,
  fromPredictorPose,
} from "../../../src/screens/hud/compass-source.ts";

function close(actual: number | null, expected: number, message = ""): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${message} beklenen ${expected}, gelen ${actual}`);
}

test("predictor pose (PR #76, 0 = +Z): angle 0 looks south (180), pi/2 looks east (90)", () => {
  close(fromPredictorPose({ x: 5, z: 7, angle: 0 }).headingDeg, 180, "0");
  close(fromPredictorPose({ x: 5, z: 7, angle: Math.PI / 2 }).headingDeg, 90, "pi/2");
  close(fromPredictorPose({ x: 5, z: 7, angle: Math.PI }).headingDeg, 0, "pi");
  close(fromPredictorPose({ x: 5, z: 7, angle: -Math.PI / 2 }).headingDeg, 270, "-pi/2");
  close(fromPredictorPose({ x: 5, z: 7, angle: (3 * Math.PI) / 2 }).headingDeg, 270, "3pi/2");
});

test("predictor pose keeps x and z and the heading is in [0, 360)", () => {
  const pose = fromPredictorPose({ x: 5, z: 7, angle: 0.3 });
  assert.equal(pose.x, 5);
  assert.equal(pose.z, 7);
  for (let a = -10; a <= 10; a += 0.37) {
    const h = fromPredictorPose({ x: 0, z: 0, angle: a }).headingDeg;
    assert.ok(h >= 0 && h < 360, `${a}: ${h}`);
  }
});

test("predictor pose: the arrow to a point that the bike drives to is 0 (x += sin, z += cos)", () => {
  for (const angle of [0, 0.5, Math.PI / 2, 2, Math.PI, 4, (3 * Math.PI) / 2, -1]) {
    const self = fromPredictorPose({ x: 5, z: 7, angle });
    const target = { x: 5 + 10 * Math.sin(angle), z: 7 + 10 * Math.cos(angle) };
    close(compassAngle(self, target), 0, `angle ${angle}`);
  }
});

test("M3 pose (PR #69, x east, y north, 0 = +x, counter clockwise): east is 90, north is 0", () => {
  close(fromM3Pose({ x: 1, y: 2, angle: 0 }).headingDeg, 90, "0");
  close(fromM3Pose({ x: 1, y: 2, angle: Math.PI / 2 }).headingDeg, 0, "pi/2");
  close(fromM3Pose({ x: 1, y: 2, angle: Math.PI }).headingDeg, 270, "pi");
  close(fromM3Pose({ x: 1, y: 2, angle: -Math.PI / 2 }).headingDeg, 180, "-pi/2");
});

test("M3 pose: z is minus y", () => {
  assert.deepEqual(fromM3Pose({ x: 4, y: 9, angle: 0 }), { x: 4, z: -9, headingDeg: 90 });
  assert.equal(fromM3Pose({ x: 4, y: -9, angle: 0 }).z, 9);
  assert.ok(Object.is(fromM3Pose({ x: 4, y: 0, angle: 0 }).z, 0), "y = 0 gives z = 0, not -0");
});

test("M3 pose: the arrow to a point that the bike drives to is 0 (x += cos, y += sin)", () => {
  for (const angle of [0, 0.5, Math.PI / 2, 2, Math.PI, 4, (3 * Math.PI) / 2, -1]) {
    const self = fromM3Pose({ x: 5, y: 7, angle });
    const target = fromM3Target({ x: 5 + 10 * Math.cos(angle), y: 7 + 10 * Math.sin(angle) });
    close(compassAngle(self, target), 0, `angle ${angle}`);
  }
});

test("M1 pose (PR #78) is the same as the M3 pose until the rule is known", () => {
  for (const angle of [0, Math.PI / 2, 2.2, -3]) {
    assert.deepEqual(fromM1Pose({ x: 3, y: -4, angle }), fromM3Pose({ x: 3, y: -4, angle }));
  }
});

test("M3 target: y north becomes z south", () => {
  assert.deepEqual(fromM3Target({ x: 3, y: 4 }), { x: 3, z: -4 });
  assert.deepEqual(fromM3Target({ x: -3, y: -4 }), { x: -3, z: 4 });
  assert.ok(Object.is(fromM3Target({ x: 0, y: 0 }).z, 0), "no -0");
});

test("end to end: a bike at the origin looking north (M3 angle pi/2) and a target 100 m north gives about 0", () => {
  const self = fromM3Pose({ x: 0, y: 0, angle: Math.PI / 2 });
  close(compassAngle(self, fromM3Target({ x: 0, y: 100 })), 0, "kuzey");
  close(compassAngle(self, fromM3Target({ x: 100, y: 0 })), 90, "doğu");
  close(compassAngle(self, fromM3Target({ x: -100, y: 0 })), -90, "batı");
  assert.equal(compassAngle(self, fromM3Target({ x: 0, y: -100 })), -180);
});

test("end to end: the same world seen by the predictor and by M3 gives the same arrow", () => {
  // A bike at (x = 20, north = 30) looking north-east. In contracts: x = 20, z = -30, heading 45 degrees.
  const m3 = fromM3Pose({ x: 20, y: 30, angle: Math.PI / 4 });
  const predictor = fromPredictorPose({ x: 20, z: -30, angle: (3 * Math.PI) / 4 }); // 180 - 135 = 45 degrees
  close(m3.headingDeg, 45, "M3");
  close(predictor.headingDeg, 45, "tahmin");
  const target = { x: 120, z: -130 };
  close(compassAngle(m3, target), 0, "M3 hedef");
  close(compassAngle(predictor, target), 0, "tahmin hedef");
});

test("a pose with a number that is not finite gives no arrow", () => {
  const bad = fromM3Pose({ x: Number.NaN, y: 0, angle: 0 });
  assert.equal(compassAngle(bad, { x: 10, z: 10 }), null);
  assert.equal(compassAngle(fromPredictorPose({ x: 0, z: 0, angle: Number.NaN }), { x: 10, z: 10 }), null);
});
