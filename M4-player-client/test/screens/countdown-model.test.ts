import assert from "node:assert/strict";
import { test } from "node:test";
import { countdownNumber, countdownText } from "../../src/screens/countdown-model.ts";

test("the number changes at every full second: 90..61 show 3, 60..31 show 2, 30..1 show 1", () => {
  for (const [ticks, number] of [
    [90, 3],
    [61, 3],
    [60, 2],
    [31, 2],
    [30, 1],
    [1, 1],
  ] as const) {
    assert.equal(countdownNumber(ticks), number, `${ticks} ticks`);
  }
});

test("no tick left shows Go, also for a negative value", () => {
  assert.equal(countdownNumber(0), 0);
  assert.equal(countdownNumber(-4), 0);
  assert.equal(countdownText(0), "Go!");
});

test("a value above 3 seconds is shown as 3", () => {
  assert.equal(countdownNumber(500), 3);
  assert.equal(countdownText(500), "3");
});

test("a missing or wrong value is not known, and is not shown as a number or as Go", () => {
  for (const value of [undefined, Number.NaN, Infinity, -Infinity]) {
    assert.equal(countdownNumber(value), null, String(value));
    assert.equal(countdownText(value), "…", String(value));
  }
});

test("the text is the number", () => {
  assert.deepEqual([90, 60, 30].map(countdownText), ["3", "2", "1"]);
});
