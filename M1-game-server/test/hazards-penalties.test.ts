import { expect, it } from "vitest";
import { Penalties } from "../src/hazards/penalties.js";
import { FakeClock, FakeParams, TPS } from "./hazards-fakes.js";

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

it("a fall starts a penalty of game.penalty_s", () => {
  const { penalties } = setup(3);
  expect(penalties.onFall(2)).toBe(true);
  expect(penalties.remainingTicks(2)).toBe(3 * TPS);
  expect(penalties.players()).toStrictEqual([2]);
  expect(penalties.remainingTicks(5)).toBe(0);
});

it("when the penalty is over, M3 gets one stand up request, in the right tick", () => {
  const { penalties } = setup(0.1); // 3 ticks
  penalties.onFall(1);
  expect(run(penalties, 10)).toStrictEqual([{ tick: 3, player: 1 }]);
  expect(penalties.players()).toStrictEqual([]);
  expect(penalties.remainingTicks(1)).toBe(0);
});

it("the full time is waited: 3 s are 90 ticks", () => {
  const { penalties } = setup(3);
  penalties.onFall(0);
  expect(run(penalties, 89)).toStrictEqual([]);
  expect(penalties.remainingTicks(0)).toBe(1);
  expect(penalties.tick()).toStrictEqual([{ player: 0 }]);
});

it("in a pause the penalty does not count down", () => {
  const { penalties, clock } = setup(0.1);
  penalties.onFall(1);
  run(penalties, 1);
  clock.clockRunning = false;
  expect(run(penalties, 500)).toStrictEqual([]);
  expect(penalties.remainingTicks(1)).toBe(2);
  clock.clockRunning = true;
  expect(run(penalties, 2)).toStrictEqual([{ tick: 2, player: 1 }]);
});

it("the same fall twice gives one penalty, in one tick or later", () => {
  const { penalties } = setup(0.1);
  expect(penalties.onFalls([{ player: 4 }, { player: 4 }])).toStrictEqual([4]);
  run(penalties, 1);
  expect(penalties.onFall(4)).toBe(false);
  expect(penalties.remainingTicks(4)).toBe(2);
  expect(run(penalties, 2)).toStrictEqual([{ tick: 2, player: 4 }]);
});

it("a fall after the stand up request is a new fall with a new penalty", () => {
  const { penalties } = setup(0.1);
  penalties.onFall(3);
  run(penalties, 3);
  expect(penalties.onFall(3)).toBe(true);
  expect(penalties.remainingTicks(3)).toBe(3);
});

it("players wait independently and the requests are sorted by player", () => {
  const { penalties } = setup(0.1);
  penalties.onFalls([{ player: 6 }, { player: 2 }]);
  expect(penalties.players()).toStrictEqual([2, 6]);
  expect(run(penalties, 3)).toStrictEqual([
    { tick: 3, player: 2 },
    { tick: 3, player: 6 },
  ]);
});

it("a later fall ends later", () => {
  const { penalties } = setup(0.1);
  penalties.onFall(0);
  run(penalties, 2);
  penalties.onFall(1);
  expect(run(penalties, 3)).toStrictEqual([
    { tick: 1, player: 0 },
    { tick: 3, player: 1 },
  ]);
});

it("a penalty of 0 s ends in the first running tick", () => {
  const { penalties, clock } = setup(0);
  clock.clockRunning = false;
  penalties.onFall(0);
  expect(run(penalties, 5)).toStrictEqual([]);
  clock.clockRunning = true;
  expect(run(penalties, 3)).toStrictEqual([{ tick: 1, player: 0 }]);
});

it("a changed parameter changes only the next fall", () => {
  const { penalties, params } = setup(3);
  penalties.onFall(0);
  params.set("game.penalty_s", 1);
  penalties.onFall(1);
  expect(penalties.remainingTicks(0)).toBe(3 * TPS);
  expect(penalties.remainingTicks(1)).toBe(1 * TPS);
});

it("a wrong player number starts nothing", () => {
  const { penalties } = setup();
  for (const p of [-1, 8, 1.5, Number.NaN]) expect(penalties.onFall(p), String(p)).toBe(false);
  expect(penalties.players()).toStrictEqual([]);
});

it("clear ends every penalty without a stand up request", () => {
  const { penalties } = setup();
  penalties.onFalls([{ player: 0 }, { player: 1 }]);
  penalties.clear();
  expect(penalties.players()).toStrictEqual([]);
  expect(run(penalties, 200)).toStrictEqual([]);
});

it("the same falls give the same requests", () => {
  function play() {
    const { penalties } = setup(0.2);
    penalties.onFalls([{ player: 5 }, { player: 1 }]);
    const a = run(penalties, 4);
    penalties.onFall(1);
    return [...a, ...run(penalties, 10)];
  }
  expect(play()).toStrictEqual(play());
});
