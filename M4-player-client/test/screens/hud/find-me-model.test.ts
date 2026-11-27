import assert from "node:assert/strict";
import { test } from "node:test";
import { findMeState } from "../../../src/screens/hud/find-me-model.ts";

test("0 ticks left: the button is ready", () => {
  assert.deepEqual(findMeState(0), { ready: true, secondsLeft: 0 });
});

test("1 tick left: not ready, 1 second", () => {
  assert.deepEqual(findMeState(1), { ready: false, secondsLeft: 1 });
});

test("30 ticks are 1 second and 31 ticks are 2 seconds (rounded up)", () => {
  assert.deepEqual(findMeState(30), { ready: false, secondsLeft: 1 });
  assert.deepEqual(findMeState(31), { ready: false, secondsLeft: 2 });
  assert.deepEqual(findMeState(60), { ready: false, secondsLeft: 2 });
  assert.deepEqual(findMeState(61), { ready: false, secondsLeft: 3 });
});

test("a long wait", () => {
  assert.deepEqual(findMeState(300), { ready: false, secondsLeft: 10 });
});

test("a part of a tick still counts as waiting for one second", () => {
  assert.deepEqual(findMeState(0.5), { ready: false, secondsLeft: 1 });
});

test("a bad value never locks the button: NaN, negative, endless or not a number are ready", () => {
  for (const value of [Number.NaN, -5, -0.1, Infinity, -Infinity, undefined as unknown as number, "30" as unknown as number]) {
    assert.deepEqual(findMeState(value), { ready: true, secondsLeft: 0 }, String(value));
  }
});
