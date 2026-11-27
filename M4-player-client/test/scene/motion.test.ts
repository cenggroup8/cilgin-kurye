import assert from "node:assert/strict";
import { test } from "node:test";
import { damp, dampAngle, Spring } from "../../src/scene/motion.ts";

test("damp moves part of the way and the same whatever the frame rate", () => {
  const once = damp(0, 1, 5, 0.1);
  let twice = damp(0, 1, 5, 0.05);
  twice = damp(twice, 1, 5, 0.05);
  assert.ok(once > 0 && once < 1);
  assert.ok(Math.abs(once - twice) < 1e-12);
});

test("dampAngle takes the short way round", () => {
  const a = dampAngle(3.1, -3.1, 50, 1);
  assert.ok(Math.abs(Math.atan2(Math.sin(a + 3.1), Math.cos(a + 3.1))) < 1e-6);
});

test("a spring starts slowly, settles on the target and stays stable with big frames", () => {
  const s = new Spring(0, 2.4, 0.72);
  s.step(1, 1 / 60);
  assert.ok(s.value < 0.05);
  for (let i = 0; i < 20; i++) s.step(1, 0.25);
  assert.ok(Math.abs(s.value - 1) < 1e-3);
});
