import assert from "node:assert/strict";
import { test } from "node:test";
import type { HudFrame } from "../../../src/screens/placeholder-types.ts";
import { fromM3Pose, fromM3Target } from "../../../src/screens/hud/compass-source.ts";
import { createGameView, type GameViewState } from "../../../src/screens/hud/game-view.ts";
import { fakeRoot } from "../fake-dom.ts";

const FRAME: HudFrame = {
  remainingSeconds: 125,
  scores: [10, 25, 5, 0],
  myTeam: 1,
  hasPackage: true,
  penaltySeconds: 0,
  findMeCooldownTicks: 0,
};

/** A bike in the rule of contracts at (100, 100) looking north, and a target 50 m to the north. */
function state(over: Partial<GameViewState> = {}): GameViewState {
  return {
    frame: FRAME,
    toast: null,
    connection: "connected",
    selfPose: { x: 100, z: 100, headingDeg: 0 },
    target: { x: 100, z: 50 },
    viewport: { width: 844, height: 390 },
    ...over,
  };
}

function setup() {
  const root = fakeRoot();
  let presses = 0;
  const view = createGameView(root as unknown as HTMLElement, { onFindMe: () => presses++ });
  const one = (name: string) => root.byClass(name)[0]!;
  return {
    root,
    view,
    presses: () => presses,
    time: one("hud-time"),
    scores: root.byClass("hud-score"),
    arrow: one("hud-compass-arrow"),
    compassLabel: one("hud-compass-label"),
    findMe: one("hud-find-me"),
    rotate: one("hud-rotate"),
    penalty: one("hud-penalty"),
    toast: one("hud-toast"),
    connection: one("hud-connection"),
  };
}

test("all parts show their part of the state", () => {
  const g = setup();
  g.view.update(state({ frame: { ...FRAME, penaltySeconds: 2.2, findMeCooldownTicks: 31 }, toast: "+10", connection: "reconnecting" }));
  assert.equal(g.time.textContent, "2:05");
  assert.deepEqual(g.scores.map((s) => s.textContent), ["Blue 10", "Green 25", "Purple 5", "Yellow 0"]);
  assert.equal(g.scores[1]!.getAttribute("data-mine"), "true");
  assert.equal(g.arrow.getAttribute("data-hidden"), "false");
  assert.equal(g.arrow.getAttribute("style"), "transform: rotate(0.0deg)");
  assert.equal(g.compassLabel.textContent, "Delivery point");
  assert.equal(g.findMe.textContent, "Find me in 2 s");
  assert.equal(g.findMe.disabled, true);
  assert.equal(g.rotate.getAttribute("data-hidden"), "true");
  assert.equal(g.penalty.getAttribute("data-hidden"), "false");
  assert.equal(g.toast.textContent, "+10");
  assert.equal(g.connection.getAttribute("data-hidden"), "false");
});

test("the arrow turns to the target: east is 90, west is -90, south is -180", () => {
  const g = setup();
  g.view.update(state({ target: { x: 150, z: 100 } }));
  assert.equal(g.arrow.getAttribute("style"), "transform: rotate(90.0deg)");
  g.view.update(state({ target: { x: 50, z: 100 } }));
  assert.equal(g.arrow.getAttribute("style"), "transform: rotate(-90.0deg)");
  g.view.update(state({ target: { x: 100, z: 150 } }));
  assert.equal(g.arrow.getAttribute("style"), "transform: rotate(-180.0deg)");
});

test("without a pose, without a target or too near the target there is no arrow", () => {
  const g = setup();
  g.view.update(state());
  g.view.update(state({ selfPose: null }));
  assert.equal(g.arrow.getAttribute("data-hidden"), "true");
  g.view.update(state());
  g.view.update(state({ target: null }));
  assert.equal(g.arrow.getAttribute("data-hidden"), "true");
  g.view.update(state());
  g.view.update(state({ target: { x: 100.2, z: 100.2 } }));
  assert.equal(g.arrow.getAttribute("data-hidden"), "true");
});

test("the label follows hasPackage of the frame", () => {
  const g = setup();
  g.view.update(state({ frame: { ...FRAME, hasPackage: false } }));
  assert.equal(g.compassLabel.textContent, "Store: pick up a package");
});

test("the Find me button calls onFindMe when ready and not while waiting", () => {
  const g = setup();
  g.view.update(state());
  g.findMe.dispatch("click");
  assert.equal(g.presses(), 1);
  g.view.update(state({ frame: { ...FRAME, findMeCooldownTicks: 45 } }));
  g.findMe.dispatch("click");
  assert.equal(g.presses(), 1);
});

test("an upright phone shows the warning and a sideways phone does not", () => {
  const g = setup();
  g.view.update(state({ viewport: { width: 390, height: 844 } }));
  assert.equal(g.rotate.getAttribute("data-hidden"), "false");
  g.view.update(state({ viewport: { width: 844, height: 390 } }));
  assert.equal(g.rotate.getAttribute("data-hidden"), "true");
});

test("a second update does not add elements and keeps the same ones", () => {
  const g = setup();
  g.view.update(state());
  const count = g.root.findAll(() => true).length;
  g.view.update(state({ frame: { ...FRAME, remainingSeconds: 124 }, toast: "+1" }));
  g.view.update(state({ viewport: { width: 390, height: 844 } }));
  assert.equal(g.root.findAll(() => true).length, count);
  assert.equal(g.root.byClass("hud-time")[0], g.time);
  assert.equal(g.root.byClass("hud-find-me")[0], g.findMe);
});

test("destroy empties the root and the button does nothing after it", () => {
  const g = setup();
  g.view.update(state());
  g.view.destroy();
  assert.equal(g.root.children.length, 0);
  g.findMe.dispatch("click");
  assert.equal(g.presses(), 0);
});

test("end to end: a bike that looks north (M3 angle pi/2) and a target to the north give 0 degrees", () => {
  const g = setup();
  g.view.update(
    state({
      selfPose: fromM3Pose({ x: 0, y: 0, angle: Math.PI / 2 }),
      target: fromM3Target({ x: 0, y: 100 }),
    }),
  );
  assert.equal(g.arrow.getAttribute("data-hidden"), "false");
  assert.equal(g.arrow.getAttribute("style"), "transform: rotate(0.0deg)");
});

test("end to end: the same bike with a target to the east gives 90 degrees", () => {
  const g = setup();
  g.view.update(
    state({
      selfPose: fromM3Pose({ x: 0, y: 0, angle: Math.PI / 2 }),
      target: fromM3Target({ x: 100, y: 0 }),
    }),
  );
  assert.equal(g.arrow.getAttribute("style"), "transform: rotate(90.0deg)");
});
