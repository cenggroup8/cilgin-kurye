import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrientationView } from "../../../src/screens/hud/orientation-view.ts";
import { fakeRoot } from "../fake-dom.ts";

function setup() {
  const root = fakeRoot();
  const view = createOrientationView(root as unknown as HTMLElement);
  return { root, view, warning: root.byClass("hud-rotate")[0]! };
}

test("before the first update the warning is hidden", () => {
  const o = setup();
  assert.equal(o.warning.getAttribute("data-hidden"), "true");
  assert.equal(o.warning.textContent, "Turn your phone sideways");
});

test("a phone held upright shows the warning", () => {
  const o = setup();
  o.view.update({ width: 390, height: 844 });
  assert.equal(o.warning.getAttribute("data-hidden"), "false");
});

test("a phone held sideways hides the warning again", () => {
  const o = setup();
  o.view.update({ width: 390, height: 844 });
  o.view.update({ width: 844, height: 390 });
  assert.equal(o.warning.getAttribute("data-hidden"), "true");
});

test("equal sides and sizes that are not valid hide the warning", () => {
  const o = setup();
  for (const [width, height] of [
    [500, 500],
    [0, 0],
    [0, 800],
    [-5, 800],
    [Number.NaN, 800],
    [390, Number.NaN],
    [Infinity, 800],
  ] as const) {
    o.view.update({ width: 390, height: 844 });
    o.view.update({ width, height });
    assert.equal(o.warning.getAttribute("data-hidden"), "true", `${width} x ${height}`);
  }
});

test("the same element is kept for every update", () => {
  const o = setup();
  o.view.update({ width: 390, height: 844 });
  o.view.update({ width: 844, height: 390 });
  assert.equal(o.root.byClass("hud-rotate").length, 1);
  assert.equal(o.root.byClass("hud-rotate")[0], o.warning);
});

test("destroy removes the warning", () => {
  const o = setup();
  o.view.destroy();
  assert.equal(o.root.children.length, 0);
});
