import assert from "node:assert/strict";
import { test } from "node:test";
import { createFindMeView } from "../../../src/screens/hud/find-me-view.ts";
import { fakeRoot } from "../fake-dom.ts";

function setup() {
  const root = fakeRoot();
  let presses = 0;
  const view = createFindMeView(root as unknown as HTMLElement, { onFindMe: () => presses++ });
  const button = root.byClass("hud-find-me")[0]!;
  return { root, view, button, presses: () => presses };
}

test("a ready button says Find me and can be pressed", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 0 });
  assert.equal(f.button.textContent, "Find me");
  assert.equal(f.button.disabled, false);
});

test("a press when ready calls onFindMe once", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 0 });
  f.button.dispatch("click");
  assert.equal(f.presses(), 1);
});

test("every press calls it once: three presses, three calls", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 0 });
  for (let i = 0; i < 3; i++) f.button.dispatch("click");
  assert.equal(f.presses(), 3);
});

test("while waiting the button is grey and a press does nothing", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 45 });
  assert.equal(f.button.disabled, true);
  f.button.dispatch("click");
  assert.equal(f.presses(), 0);
});

test("the wait text is the seconds rounded up: 31 ticks are 2 seconds", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 31 });
  assert.equal(f.button.textContent, "Find me in 2 s");
  f.view.update({ cooldownTicks: 30 });
  assert.equal(f.button.textContent, "Find me in 1 s");
  f.view.update({ cooldownTicks: 1 });
  assert.equal(f.button.textContent, "Find me in 1 s");
});

test("when the wait is over the button is ready again", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 31 });
  f.button.dispatch("click");
  f.view.update({ cooldownTicks: 0 });
  assert.equal(f.button.textContent, "Find me");
  assert.equal(f.button.disabled, false);
  f.button.dispatch("click");
  assert.equal(f.presses(), 1);
});

test("a bad number of ticks means ready, so it never locks the button", () => {
  const f = setup();
  for (const cooldownTicks of [Number.NaN, -5, Infinity, undefined as unknown as number]) {
    f.view.update({ cooldownTicks: 99 });
    f.view.update({ cooldownTicks });
    assert.equal(f.button.disabled, false, String(cooldownTicks));
    assert.equal(f.button.textContent, "Find me", String(cooldownTicks));
  }
});

test("the permission to press follows the last update", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 0 });
  f.view.update({ cooldownTicks: 60 });
  f.button.dispatch("click");
  assert.equal(f.presses(), 0);
});

test("before the first update the button is ready", () => {
  const f = setup();
  assert.equal(f.button.disabled, false);
  f.button.dispatch("click");
  assert.equal(f.presses(), 1);
});

test("after destroy a press calls nothing and the button is gone", () => {
  const f = setup();
  f.view.update({ cooldownTicks: 0 });
  f.view.destroy();
  f.button.dispatch("click");
  assert.equal(f.presses(), 0);
  assert.equal(f.root.children.length, 0);
});
