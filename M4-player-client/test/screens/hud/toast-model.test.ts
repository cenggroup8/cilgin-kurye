import assert from "node:assert/strict";
import { test } from "node:test";
import { createToastModel, scoreToast } from "../../../src/screens/hud/toast-model.ts";

/** A clock that only moves when the test says so. */
function fakeClock(start = 1000) {
  return {
    time: start,
    now() {
      return this.time;
    },
  };
}

test("a pushed message is shown right away", () => {
  const toast = createToastModel(fakeClock(), { durationMs: 2000 });
  assert.equal(toast.pull(), null);
  toast.push("+10");
  assert.equal(toast.pull(), "+10");
  assert.equal(toast.pull(), "+10");
});

test("a message goes when its time is over, not before", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 2000 });
  toast.push("+10");
  clock.time += 1999;
  assert.equal(toast.pull(), "+10");
  clock.time += 1;
  assert.equal(toast.pull(), null);
});

test("messages come in the order they were added, each for its own time", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 1000 });
  toast.push("A");
  toast.push("B");
  toast.push("C");
  const seen: Array<string | null> = [];
  for (let i = 0; i < 4; i++) {
    seen.push(toast.pull());
    clock.time += 1000;
  }
  assert.deepEqual(seen, ["A", "B", "C", null]);
});

test("the time of the next message starts when it comes to the front", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 1000 });
  toast.push("A");
  toast.push("B");
  clock.time += 1000;
  assert.equal(toast.pull(), "B");
  clock.time += 999;
  assert.equal(toast.pull(), "B");
  clock.time += 1;
  assert.equal(toast.pull(), null);
});

test("the same message twice in a row is added once", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 1000 });
  toast.push("+5");
  toast.push("+5");
  toast.push("+5");
  clock.time += 1000;
  assert.equal(toast.pull(), null);
});

test("the same message after another one is added again", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 1000 });
  toast.push("+5");
  toast.push("+10");
  toast.push("+5");
  const seen: Array<string | null> = [];
  for (let i = 0; i < 4; i++) {
    seen.push(toast.pull());
    clock.time += 1000;
  }
  assert.deepEqual(seen, ["+5", "+10", "+5", null]);
});

test("the same message is shown again after the first one is gone", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 1000 });
  toast.push("+5");
  clock.time += 1000;
  assert.equal(toast.pull(), null);
  toast.push("+5");
  assert.equal(toast.pull(), "+5");
});

test("tick moves on without a pull", () => {
  const clock = fakeClock();
  const toast = createToastModel(clock, { durationMs: 1000 });
  toast.push("A");
  toast.push("B");
  clock.time += 1000;
  toast.tick();
  clock.time += 500;
  assert.equal(toast.pull(), "B");
});

test("a bad duration is refused", () => {
  for (const durationMs of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => createToastModel(fakeClock(), { durationMs }), RangeError, String(durationMs));
  }
});

test("scoreToast gives +N when the points of the own team went up", () => {
  assert.equal(scoreToast([0, 0, 0, 0], [10, 0, 0, 0], 0), "+10");
  assert.equal(scoreToast([10, 5, 0, 0], [10, 12, 0, 0], 1), "+7");
});

test("scoreToast gives nothing when the score went down or stayed the same", () => {
  assert.equal(scoreToast([10, 0, 0, 0], [5, 0, 0, 0], 0), null);
  assert.equal(scoreToast([10, 0, 0, 0], [10, 0, 0, 0], 0), null);
});

test("scoreToast gives nothing on the first frame", () => {
  assert.equal(scoreToast(null, [10, 0, 0, 0], 0), null);
  assert.equal(scoreToast(undefined, [10, 0, 0, 0], 0), null);
});

test("scoreToast gives nothing for the points of another team or without a team", () => {
  assert.equal(scoreToast([0, 0, 0, 0], [0, 9, 0, 0], 0), null);
  assert.equal(scoreToast([0, 0, 0, 0], [9, 0, 0, 0], null), null);
});

test("scoreToast ignores wrong numbers and cuts a decimal", () => {
  assert.equal(scoreToast([0, 0, 0, 0], [Number.NaN, 0, 0, 0], 0), null);
  assert.equal(scoreToast([Number.NaN, 0, 0, 0], [4, 0, 0, 0], 0), "+4");
  assert.equal(scoreToast([0, 0, 0, 0], [2.9, 0, 0, 0], 0), "+2");
  assert.equal(scoreToast([], [3, 0, 0, 0], 0), "+3");
});
