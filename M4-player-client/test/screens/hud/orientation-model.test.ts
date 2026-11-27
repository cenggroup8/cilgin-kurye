import assert from "node:assert/strict";
import { test } from "node:test";
import { needsRotateWarning } from "../../../src/screens/hud/orientation-model.ts";

test("a phone held upright (higher than wide) shows the warning", () => {
  assert.equal(needsRotateWarning(390, 844), true);
  assert.equal(needsRotateWarning(1, 2), true);
});

test("a phone held sideways does not", () => {
  assert.equal(needsRotateWarning(844, 390), false);
});

test("equal sides do not show the warning", () => {
  assert.equal(needsRotateWarning(500, 500), false);
});

test("a size that is zero, negative or missing does not show the warning", () => {
  for (const [w, h] of [
    [0, 100],
    [100, 0],
    [0, 0],
    [-10, 100],
    [100, -10],
    [Number.NaN, 100],
    [100, Number.NaN],
    [Infinity, 100],
    [100, Infinity],
    [undefined, 100],
    [100, undefined],
  ] as const) {
    assert.equal(needsRotateWarning(w as number, h as number), false, `${w} x ${h}`);
  }
});
