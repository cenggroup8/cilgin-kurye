// Tests of the HUD view with the small fake DOM (see ../fake-dom.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionState, HudFrame } from "../../../src/screens/placeholder-types.ts";
import { createHudView, type HudViewState } from "../../../src/screens/hud/hud-view.ts";
import { fakeRoot } from "../fake-dom.ts";

const FRAME: HudFrame = {
  remainingSeconds: 125,
  scores: [10, 25, 5, 0],
  myTeam: 2,
  hasPackage: false,
  penaltySeconds: 0,
  findMeCooldownTicks: 0,
};

function state(over: Partial<HudViewState> & { frame?: Partial<HudFrame> } = {}): HudViewState {
  return {
    frame: { ...FRAME, ...over.frame },
    toast: over.toast ?? null,
    connection: over.connection ?? "connected",
  };
}

function setup() {
  const root = fakeRoot();
  const view = createHudView(root as unknown as HTMLElement);
  const one = (name: string) => root.byClass(name)[0]!;
  return {
    root,
    view,
    time: one("hud-time"),
    scores: root.byClass("hud-score"),
    penalty: one("hud-penalty"),
    toast: one("hud-toast"),
    connection: one("hud-connection"),
  };
}

const hidden = (node: { getAttribute(name: string): string | null }) => node.getAttribute("data-hidden");

test("before the first update nothing but the zero time is shown", () => {
  const h = setup();
  assert.equal(h.time.textContent, "0:00");
  assert.deepEqual(h.scores.map((s) => s.textContent), ["Blue 0", "Green 0", "Purple 0", "Yellow 0"]);
  assert.equal(hidden(h.penalty), "true");
  assert.equal(hidden(h.toast), "true");
  assert.equal(hidden(h.connection), "true");
});

test("the time is shown as m:ss", () => {
  const h = setup();
  h.view.update(state());
  assert.equal(h.time.textContent, "2:05");
  h.view.update(state({ frame: { remainingSeconds: 59.9 } }));
  assert.equal(h.time.textContent, "0:59");
  h.view.update(state({ frame: { remainingSeconds: Number.NaN } }));
  assert.equal(h.time.textContent, "0:00");
});

test("the four scores come in the order of the lobby and show the own team", () => {
  const h = setup();
  h.view.update(state());
  assert.deepEqual(h.scores.map((s) => s.textContent), ["Blue 10", "Green 25", "Purple 5", "Yellow 0"]);
  assert.deepEqual(h.scores.map((s) => s.getAttribute("data-mine")), ["false", "false", "true", "false"]);
  assert.deepEqual(h.scores.map((s) => s.getAttribute("data-team")), ["0", "1", "2", "3"]);
  assert.match(h.scores[3]!.getAttribute("style") ?? "", /--team-color:#e0b020/);
});

test("without a known team no score is marked", () => {
  const h = setup();
  h.view.update(state({ frame: { myTeam: null } }));
  assert.equal(h.scores.some((s) => s.getAttribute("data-mine") === "true"), false);
});

test("the penalty is shown while the player waits and hidden after", () => {
  const h = setup();
  h.view.update(state({ frame: { penaltySeconds: 2.1 } }));
  assert.equal(hidden(h.penalty), "false");
  assert.equal(h.penalty.textContent, "You fell. Wait 3 s");
  h.view.update(state({ frame: { penaltySeconds: 0 } }));
  assert.equal(hidden(h.penalty), "true");
  assert.equal(h.penalty.textContent, "");
});

test("the toast is shown when there is a message and hidden when there is none", () => {
  const h = setup();
  h.view.update(state({ toast: "+10" }));
  assert.equal(hidden(h.toast), "false");
  assert.equal(h.toast.textContent, "+10");
  h.view.update(state({ toast: null }));
  assert.equal(hidden(h.toast), "true");
  assert.equal(h.toast.textContent, "");
  h.view.update(state({ toast: "" }));
  assert.equal(hidden(h.toast), "true");
});

test("the connection band is hidden when connected and shown when the link is lost", () => {
  const h = setup();
  h.view.update(state({ connection: "connected" }));
  assert.equal(hidden(h.connection), "true");
  h.view.update(state({ connection: "reconnecting" }));
  assert.equal(hidden(h.connection), "false");
  assert.equal(h.connection.textContent, "Connection lost. Trying again…");
  h.view.update(state({ connection: "connected" }));
  assert.equal(hidden(h.connection), "true");
});

test("any state other than connected shows the band", () => {
  const h = setup();
  h.view.update(state({ connection: "gone" as unknown as ConnectionState }));
  assert.equal(hidden(h.connection), "false");
});

test("a second update keeps the same elements and does not add new ones", () => {
  const h = setup();
  h.view.update(state());
  const count = h.root.findAll(() => true).length;
  const time = h.root.byClass("hud-time")[0];
  const firstScore = h.root.byClass("hud-score")[0];
  h.view.update(state({ frame: { remainingSeconds: 124, scores: [11, 25, 5, 0] }, toast: "+1" }));
  h.view.update(state({ frame: { remainingSeconds: 123 }, connection: "reconnecting" }));
  assert.equal(h.root.findAll(() => true).length, count);
  assert.equal(h.root.byClass("hud-time")[0], time);
  assert.equal(h.root.byClass("hud-score")[0], firstScore);
  assert.equal(time!.textContent, "2:03");
});

test("text from outside is not read as HTML", () => {
  const h = setup();
  const evil = '<img src=x onerror="alert(1)"><b>bold</b>';
  h.view.update(state({ toast: evil }));
  assert.equal(h.toast.textContent, evil);
  assert.equal(h.toast.children.length, 0);
});

test("destroy removes the whole HUD", () => {
  const h = setup();
  h.view.update(state({ toast: "+1" }));
  h.view.destroy();
  assert.equal(h.root.children.length, 0);
});
