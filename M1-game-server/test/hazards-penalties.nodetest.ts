// Run from the repository root (Node 24 runs TypeScript directly):
//   node --test "M1-game-server/test/*.nodetest.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { Penalties } from "../src/hazards/penalties.ts";
import { FakeClock, FakeParams, TPS } from "./hazards-fakes.ts";

function setup(penaltySeconds = 3) {
  const params = new FakeParams();
  params.set("game.penalty_s", penaltySeconds);
  const clock = new FakeClock();
  const penalties = new Penalties({ params, clock });
  return { params, clock, penalties };
}

function run(p: Penalties, ticks: number) {
  const requests: Array<{ tick: number; player: number }> = [];
  for (let i = 1; i <= ticks; i++) for (const r of p.tick()) requests.push({ tick: i, player: r.player });
  return requests;
}

test("a fall starts a penalty of game.penalty_s", () => {
  const { penalties } = setup(3);
  assert.equal(penalties.onFall(2), true);
  assert.equal(penalties.remainingTicks(2), 3 * TPS);
  assert.deepEqual(penalties.players(), [2]);
  assert.equal(penalties.remainingTicks(5), 0);
});

test("when the penalty is over, M3 gets one stand up request, in the right tick", () => {
  const { penalties } = setup(0.1); // 3 ticks
  penalties.onFall(1);
  assert.deepEqual(run(penalties, 10), [{ tick: 3, player: 1 }]);
  assert.deepEqual(penalties.players(), []);
  assert.equal(penalties.remainingTicks(1), 0);
});

test("the full time is waited: 3 s are 90 ticks", () => {
  const { penalties } = setup(3);
  penalties.onFall(0);
  assert.deepEqual(run(penalties, 89), []);
  assert.equal(penalties.remainingTicks(0), 1);
  assert.deepEqual(penalties.tick(), [{ player: 0 }]);
});

test("in a pause the penalty does not count down", () => {
  const { penalties, clock } = setup(0.1);
  penalties.onFall(1);
  run(penalties, 1);
  clock.clockRunning = false;
  assert.deepEqual(run(penalties, 500), []);
  assert.equal(penalties.remainingTicks(1), 2);
  clock.clockRunning = true;
  assert.deepEqual(run(penalties, 2), [{ tick: 2, player: 1 }]);
});

test("the same fall twice gives one penalty, in one tick or later", () => {
  const { penalties } = setup(0.1);
  assert.deepEqual(penalties.onFalls([{ player: 4 }, { player: 4 }]), [4]);
  run(penalties, 1);
  assert.equal(penalties.onFall(4), false);
  assert.equal(penalties.remainingTicks(4), 2);
  assert.deepEqual(run(penalties, 2), [{ tick: 2, player: 4 }]);
});

test("a fall after the stand up request is a new fall with a new penalty", () => {
  const { penalties } = setup(0.1);
  penalties.onFall(3);
  run(penalties, 3);
  assert.equal(penalties.onFall(3), true);
  assert.equal(penalties.remainingTicks(3), 3);
});

test("players wait independently and the requests are sorted by player", () => {
  const { penalties } = setup(0.1);
  penalties.onFalls([{ player: 6 }, { player: 2 }]);
  assert.deepEqual(penalties.players(), [2, 6]);
  assert.deepEqual(run(penalties, 3), [
    { tick: 3, player: 2 },
    { tick: 3, player: 6 },
  ]);
});

test("a later fall ends later", () => {
  const { penalties } = setup(0.1);
  penalties.onFall(0);
  run(penalties, 2);
  penalties.onFall(1);
  assert.deepEqual(run(penalties, 3), [
    { tick: 1, player: 0 },
    { tick: 3, player: 1 },
  ]);
});

test("a penalty of 0 s ends in the first running tick", () => {
  const { penalties, clock } = setup(0);
  clock.clockRunning = false;
  penalties.onFall(0);
  assert.deepEqual(run(penalties, 5), []);
  clock.clockRunning = true;
  assert.deepEqual(run(penalties, 3), [{ tick: 1, player: 0 }]);
});

test("a changed parameter changes only the next fall", () => {
  const { penalties, params } = setup(3);
  penalties.onFall(0);
  params.set("game.penalty_s", 1);
  penalties.onFall(1);
  assert.equal(penalties.remainingTicks(0), 3 * TPS);
  assert.equal(penalties.remainingTicks(1), 1 * TPS);
});

test("a wrong player number starts nothing", () => {
  const { penalties } = setup();
  for (const p of [-1, 8, 1.5, Number.NaN]) assert.equal(penalties.onFall(p), false, String(p));
  assert.deepEqual(penalties.players(), []);
});

test("clear ends every penalty without a stand up request", () => {
  const { penalties } = setup();
  penalties.onFalls([{ player: 0 }, { player: 1 }]);
  penalties.clear();
  assert.deepEqual(penalties.players(), []);
  assert.deepEqual(run(penalties, 200), []);
});

test("the same falls give the same requests", () => {
  function play() {
    const { penalties } = setup(0.2);
    penalties.onFalls([{ player: 5 }, { player: 1 }]);
    const a = run(penalties, 4);
    penalties.onFall(1);
    return [...a, ...run(penalties, 10)];
  }
  assert.deepEqual(play(), play());
});
