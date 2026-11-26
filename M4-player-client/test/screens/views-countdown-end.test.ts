// Tests of the countdown and end views with the small fake DOM (see fake-dom.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCountdownView } from "../../src/screens/countdown-view.ts";
import { createEndView } from "../../src/screens/end-view.ts";
import { fakeRoot } from "./fake-dom.ts";

function countdownSetup() {
  const root = fakeRoot();
  const view = createCountdownView(root as unknown as HTMLElement);
  const digit = root.byClass("countdown-number")[0]!;
  return { root, view, digit };
}

test("countdown: before the first state the number is not known", () => {
  const c = countdownSetup();
  assert.equal(c.digit.textContent, "…");
  assert.equal(c.root.findAll((n) => n.tag === "h1")[0]!.textContent, "Get ready");
});

test("countdown: 3, 2, 1 and then Go", () => {
  const c = countdownSetup();
  const shown: string[] = [];
  for (const ticks of [90, 75, 60, 45, 30, 15, 1, 0]) {
    c.view.update(ticks);
    shown.push(c.digit.textContent);
  }
  assert.deepEqual(shown, ["3", "3", "2", "2", "1", "1", "1", "Go!"]);
});

test("countdown: a state without the value does not show Go", () => {
  const c = countdownSetup();
  c.view.update(30);
  c.view.update(undefined);
  assert.equal(c.digit.textContent, "…");
});

test("countdown: the number is read out by screen readers", () => {
  const c = countdownSetup();
  assert.equal(c.digit.getAttribute("role"), "status");
  assert.equal(c.digit.getAttribute("aria-live"), "assertive");
});

test("countdown: destroy removes the screen", () => {
  const c = countdownSetup();
  c.view.destroy();
  assert.equal(c.root.children.length, 0);
});

function endSetup() {
  const root = fakeRoot();
  const view = createEndView(root as unknown as HTMLElement);
  const headline = root.byClass("result-title")[0]!;
  const rows = root.byClass("score-row");
  return { root, view, headline, rows };
}

test("end: four rows from the start, and a neutral headline", () => {
  const e = endSetup();
  assert.equal(e.rows.length, 4);
  assert.equal(e.headline.textContent, "Game over");
  assert.equal(e.headline.getAttribute("data-result"), "none");
});

test("end: the winner and all scores are shown, best first", () => {
  const e = endSetup();
  e.view.update([10, 25, 5, 0], [1], null);
  assert.equal(e.headline.textContent, "Green wins!");
  assert.equal(e.headline.getAttribute("data-result"), "win");
  assert.deepEqual(
    e.rows.map((r) => r.textContent),
    ["Green · 25 · Winner", "Blue · 10", "Purple · 5", "Yellow · 0"],
  );
  assert.deepEqual(
    e.rows.map((r) => r.getAttribute("data-winner")),
    ["true", "false", "false", "false"],
  );
  assert.match(e.rows[0]!.getAttribute("style") ?? "", /--team-color:#2e9e55/);
});

test("end: a draw names every winner and marks every winner row", () => {
  const e = endSetup();
  e.view.update([20, 5, 20, 0], [0, 2], null);
  assert.equal(e.headline.textContent, "Draw: Blue and Purple");
  assert.equal(e.headline.getAttribute("data-result"), "draw");
  assert.deepEqual(
    e.rows.map((r) => r.getAttribute("data-winner")),
    ["true", "true", "false", "false"],
  );
});

test("end: the own team is marked", () => {
  const e = endSetup();
  e.view.update([7, 1, 0, 2], [0], 3);
  const mine = e.rows.filter((r) => r.getAttribute("data-mine") === "true");
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.textContent, "Yellow · 2 · Your team");
});

test("end: a new update replaces the old result", () => {
  const e = endSetup();
  e.view.update([10, 25, 5, 0], [1], 1);
  e.view.update([3, 0, 9, 0], [2], null);
  assert.equal(e.headline.textContent, "Purple wins!");
  assert.equal(e.rows[0]!.textContent, "Purple · 9 · Winner");
  assert.equal(e.rows.some((r) => r.getAttribute("data-mine") === "true"), false);
  assert.equal(e.rows.length, 4);
});

test("end: destroy removes the screen", () => {
  const e = endSetup();
  e.view.destroy();
  assert.equal(e.root.children.length, 0);
});
