import assert from "node:assert/strict";
import { test } from "node:test";
import { TEAMS, teamSlots } from "../../src/screens/lobby-model.ts";

test("there are four teams in the order of contracts/README.md", () => {
  assert.deepEqual(
    TEAMS.map((t) => [t.id, t.name]),
    [
      [0, "Blue"],
      [1, "Green"],
      [2, "Purple"],
      [3, "Yellow"],
    ],
  );
});

test("an empty lobby: every team can be picked", () => {
  const slots = teamSlots([0, 0, 0, 0], null);
  assert.equal(slots.length, 4);
  for (const slot of slots) {
    assert.equal(slot.selectable, true);
    assert.equal(slot.full, false);
    assert.equal(slot.mine, false);
  }
  assert.equal(slots[0]!.label, "Blue · 0/2");
});

test("a full team cannot be picked and says so", () => {
  const slot = teamSlots([2, 0, 0, 0], null)[0]!;
  assert.equal(slot.full, true);
  assert.equal(slot.selectable, false);
  assert.equal(slot.label, "Blue · 2/2 · Full");
});

test("the own team is marked, and it is not pressed again", () => {
  const slots = teamSlots([0, 1, 0, 0], 1);
  assert.equal(slots[1]!.mine, true);
  assert.equal(slots[1]!.selectable, false);
  assert.equal(slots[1]!.label, "Green · 1/2 · Your team");
  assert.equal(slots[0]!.selectable, true);
});

test("the own team in a full team shows Your team, not Full", () => {
  const slot = teamSlots([0, 0, 2, 0], 2)[2]!;
  assert.equal(slot.full, true);
  assert.equal(slot.mine, true);
  assert.equal(slot.label, "Purple · 2/2 · Your team");
});

test("a short, negative or wrong count is read as an empty team", () => {
  const slots = teamSlots([1], null);
  assert.equal(slots[0]!.count, 1);
  assert.equal(slots[3]!.count, 0);
  assert.equal(teamSlots([-3, Number.NaN, Infinity, 1.9], null)[3]!.count, 1);
  assert.equal(teamSlots([-3, Number.NaN], null)[0]!.count, 0);
  assert.equal(teamSlots([-3, Number.NaN], null)[1]!.count, 0);
});

test("a count above the limit is full and shows 2/2", () => {
  const slot = teamSlots([5, 0, 0, 0], null)[0]!;
  assert.equal(slot.full, true);
  assert.equal(slot.label, "Blue · 2/2 · Full");
});
