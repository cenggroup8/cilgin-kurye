import assert from "node:assert/strict";
import { test } from "node:test";
import { endResult, listNames } from "../../src/screens/end-model.ts";

test("one winner: the headline names the team and the winner is marked", () => {
  const r = endResult([10, 25, 5, 0], [1], null);
  assert.equal(r.kind, "win");
  assert.deepEqual(r.winners, [1]);
  assert.equal(r.headline, "Green wins!");
  assert.equal(r.rows[0]!.label, "Green · 25 · Winner");
});

test("all four teams are listed, best first", () => {
  const r = endResult([10, 25, 5, 0], [1], null);
  assert.deepEqual(
    r.rows.map((row) => [row.name, row.score]),
    [
      ["Green", 25],
      ["Blue", 10],
      ["Purple", 5],
      ["Yellow", 0],
    ],
  );
});

test("the same score keeps the team order", () => {
  const r = endResult([20, 5, 20, 5], [0, 2], null);
  assert.deepEqual(r.rows.map((row) => row.name), ["Blue", "Purple", "Green", "Yellow"]);
});

test("a draw between two teams names both", () => {
  const r = endResult([20, 5, 20, 0], [0, 2], null);
  assert.equal(r.kind, "draw");
  assert.deepEqual(r.winners, [0, 2]);
  assert.equal(r.headline, "Draw: Blue and Purple");
  assert.deepEqual(r.rows.filter((row) => row.winner).map((row) => row.name), ["Blue", "Purple"]);
});

test("a draw between three teams uses commas and and", () => {
  assert.equal(endResult([5, 5, 5, 0], [0, 1, 2], null).headline, "Draw: Blue, Green and Purple");
});

test("without a winner in the data the page shows only the scores", () => {
  const r = endResult([3, 2, 1, 0], [], null);
  assert.equal(r.kind, "none");
  assert.equal(r.headline, "Game over");
  assert.equal(r.rows.some((row) => row.winner), false);
  assert.equal(r.rows.length, 4);
});

test("the own team is marked, also when it is the winner", () => {
  const r = endResult([7, 1, 0, 2], [0], 3);
  assert.equal(r.rows.find((row) => row.team === 3)!.label, "Yellow · 2 · Your team");
  assert.equal(r.rows.find((row) => row.team === 3)!.mine, true);
  assert.equal(endResult([7, 1, 0, 2], [0], 0).rows[0]!.label, "Blue · 7 · Winner · Your team");
  assert.equal(endResult([7, 1, 0, 2], [0], null).rows.some((row) => row.mine), false);
});

test("missing, negative and wrong scores are read as 0, and a decimal is cut", () => {
  const r = endResult([Number.NaN, -5, Infinity, 7.9], [3], null);
  assert.deepEqual(r.rows.map((row) => [row.name, row.score]), [
    ["Yellow", 7],
    ["Blue", 0],
    ["Green", 0],
    ["Purple", 0],
  ]);
  assert.deepEqual(endResult([4], [0], null).rows.map((row) => row.score), [4, 0, 0, 0]);
  assert.deepEqual(endResult([], [], null).rows.map((row) => row.score), [0, 0, 0, 0]);
});

test("a winner number that is not a team is ignored, and a team is counted once", () => {
  assert.deepEqual(endResult([0, 0, 9, 0], [7, -1, 1.5, 2], null).winners, [2]);
  const r = endResult([0, 9, 0, 0], [1, 1], null);
  assert.equal(r.kind, "win");
  assert.deepEqual(r.winners, [1]);
});

test("listNames", () => {
  assert.equal(listNames([]), "");
  assert.equal(listNames(["Blue"]), "Blue");
  assert.equal(listNames(["Blue", "Green"]), "Blue and Green");
  assert.equal(listNames(["Blue", "Green", "Yellow"]), "Blue, Green and Yellow");
});
