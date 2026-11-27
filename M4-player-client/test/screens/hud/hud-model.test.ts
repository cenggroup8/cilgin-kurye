import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTime, penaltyText, scoreRows } from "../../../src/screens/hud/hud-model.ts";

test("formatTime shows minutes and two digits of seconds", () => {
  for (const [seconds, text] of [
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [61, "1:01"],
    [300, "5:00"],
    [299, "4:59"],
  ] as const) {
    assert.equal(formatTime(seconds), text, String(seconds));
  }
});

test("formatTime cuts a fraction down", () => {
  assert.equal(formatTime(59.9), "0:59");
  assert.equal(formatTime(0.99), "0:00");
  assert.equal(formatTime(120.5), "2:00");
});

test("formatTime shows 0:00 for a negative, missing or endless value", () => {
  for (const value of [-1, -0.5, Number.NaN, Infinity, -Infinity, undefined as unknown as number]) {
    assert.equal(formatTime(value), "0:00", String(value));
  }
});

test("scoreRows gives the four teams in the order of the lobby", () => {
  const rows = scoreRows([10, 25, 5, 0], null);
  assert.deepEqual(
    rows.map((r) => [r.team, r.name, r.score]),
    [
      [0, "Blue", 10],
      [1, "Green", 25],
      [2, "Purple", 5],
      [3, "Yellow", 0],
    ],
  );
});

test("scoreRows does not sort by points", () => {
  assert.deepEqual(scoreRows([1, 9, 3, 5], null).map((r) => r.team), [0, 1, 2, 3]);
});

test("scoreRows marks only the team of this phone", () => {
  assert.deepEqual(scoreRows([1, 2, 3, 4], 2).map((r) => r.mine), [false, false, true, false]);
  assert.equal(scoreRows([1, 2, 3, 4], null).some((r) => r.mine), false);
});

test("scoreRows gives every row the colour of its team", () => {
  assert.deepEqual(scoreRows([0, 0, 0, 0], null).map((r) => r.color), ["#2f6fdb", "#2e9e55", "#8a4fd0", "#e0b020"]);
});

test("scoreRows reads a short list, a negative or a wrong score as 0 and cuts a decimal", () => {
  assert.deepEqual(scoreRows([4], null).map((r) => r.score), [4, 0, 0, 0]);
  assert.deepEqual(scoreRows([], null).map((r) => r.score), [0, 0, 0, 0]);
  assert.deepEqual(scoreRows([-3, Number.NaN, Infinity, 7.9], null).map((r) => r.score), [0, 0, 0, 7]);
});

test("penaltyText gives nothing when the player does not wait", () => {
  for (const value of [0, -1, Number.NaN, Infinity, undefined as unknown as number]) {
    assert.equal(penaltyText(value), null, String(value));
  }
});

test("penaltyText rounds the seconds up", () => {
  assert.equal(penaltyText(3), "You fell. Wait 3 s");
  assert.equal(penaltyText(2.01), "You fell. Wait 3 s");
  assert.equal(penaltyText(0.2), "You fell. Wait 1 s");
  assert.equal(penaltyText(1), "You fell. Wait 1 s");
});
