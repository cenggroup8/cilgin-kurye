// Run from the repository root (Node 24 runs TypeScript directly):
//   node --test "M1-game-server/test/*.nodetest.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { OBSTACLE_TYPES } from "../src/hazards/estimates.ts";
import { ObstacleList } from "../src/hazards/obstacles.ts";
import { FakeClock, FakeParams, TPS } from "./hazards-fakes.ts";

function setup() {
  const params = new FakeParams();
  const clock = new FakeClock();
  const list = new ObstacleList({ params, clock });
  return { params, clock, list };
}

function run(list: ObstacleList, ticks: number): void {
  for (let i = 0; i < ticks; i++) list.tick();
}

const ROAD_WORK = { type: "road_work", segment: 12, lane: 1, pos: 0.5 } as const;

test("a new obstacle gets an id, an end time from its parameter, and raises the version", () => {
  const { list } = setup();
  assert.equal(list.version, 0);
  const r = list.addObstacle(ROAD_WORK);
  assert.deepEqual(r, { ok: true, id: 0 });
  assert.equal(list.version, 1);
  const [o] = list.items;
  assert.deepEqual(o, { id: 0, type: "road_work", segment: 12, lane: 1, pos: 0.5, source: "admin", endTick: 30 * TPS });
});

test("ids count up and every change raises the version by one", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  list.addObstacle({ ...ROAD_WORK, segment: 13 });
  list.removeObstacle(0);
  assert.deepEqual(list.items.map((o) => o.id), [1]);
  assert.equal(list.version, 3);
});

test("a wrong obstacle is refused and changes nothing", () => {
  const { list } = setup();
  const bad = [
    [{ ...ROAD_WORK, segment: -1 }, "unknown_road"],
    [{ ...ROAD_WORK, segment: 60 }, "unknown_road"],
    [{ ...ROAD_WORK, segment: 1.5 }, "unknown_road"],
    [{ ...ROAD_WORK, lane: 5 }, "unknown_lane"],
    [{ ...ROAD_WORK, lane: -1 }, "unknown_lane"],
    [{ ...ROAD_WORK, pos: 1.1 }, "bad_pos"],
    [{ ...ROAD_WORK, pos: Number.NaN }, "bad_pos"],
    [{ ...ROAD_WORK, type: "lava" }, "bad_type"],
  ] as const;
  for (const [input, error] of bad) {
    assert.deepEqual(list.addObstacle(input as never), { ok: false, error });
  }
  assert.equal(list.items.length, 0);
  assert.equal(list.version, 0);
});

test("every road of the city plan and the edges of lane and position are accepted", () => {
  const { list } = setup();
  assert.equal(list.addObstacle({ ...ROAD_WORK, segment: 0, lane: 0, pos: 0 }).ok, true);
  assert.equal(list.addObstacle({ ...ROAD_WORK, segment: 59, lane: 4, pos: 1 }).ok, true);
});

test("removing an unknown id is refused and does not raise the version", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  assert.deepEqual(list.removeObstacle(7), { ok: false, error: "unknown_obstacle" });
  assert.equal(list.version, 1);
  assert.deepEqual(list.removeObstacle(0), { ok: true });
  assert.equal(list.items.length, 0);
  assert.equal(list.version, 2);
});

test("close road puts road work on the whole segment, once", () => {
  const { list } = setup();
  const first = list.closeRoad(20);
  assert.deepEqual(first, { ok: true, id: 0 });
  assert.deepEqual(list.items[0], { id: 0, type: "road_work", segment: 20, lane: 0, pos: 0.5, source: "admin", endTick: 900 });
  const again = list.closeRoad(20);
  assert.deepEqual(again, { ok: true, id: 0 });
  assert.equal(list.items.length, 1);
  assert.equal(list.version, 1);
  assert.deepEqual(list.closeRoad(60), { ok: false, error: "unknown_road" });
});

test("the time of an obstacle comes from the parameter of its type", () => {
  const { list, params } = setup();
  params.set("obstacles.puddle.duration_s", 10);
  params.set("obstacles.accident.duration_s", 0.5);
  list.addObstacle({ ...ROAD_WORK, type: "puddle" });
  list.addObstacle({ ...ROAD_WORK, type: "accident" });
  assert.deepEqual(list.items.map((o) => o.endTick), [10 * TPS, 15]);
});

test("a changed parameter does not change an obstacle that is already there", () => {
  const { list, params } = setup();
  list.addObstacle(ROAD_WORK);
  params.set("obstacles.road_work.duration_s", 5);
  list.addObstacle({ ...ROAD_WORK, segment: 14 });
  assert.deepEqual(list.items.map((o) => o.endTick), [900, 150]);
});

test("an obstacle ends exactly at its end time and the version goes up once", () => {
  const { list, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1); // 3 ticks
  list.addObstacle(ROAD_WORK);
  const v = list.version;
  run(list, 2);
  assert.equal(list.items.length, 1);
  assert.equal(list.version, v);
  const ended = list.tick();
  assert.deepEqual(ended.map((o) => o.id), [0]);
  assert.equal(list.items.length, 0);
  assert.equal(list.version, v + 1);
  run(list, 5);
  assert.equal(list.version, v + 1);
});

test("two obstacles that end in the same tick raise the version once", () => {
  const { list, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  list.addObstacle(ROAD_WORK);
  list.addObstacle({ ...ROAD_WORK, segment: 13 });
  const v = list.version;
  run(list, 3);
  assert.equal(list.items.length, 0);
  assert.equal(list.version, v + 1);
});

test("an obstacle added later ends later", () => {
  const { list, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  list.addObstacle(ROAD_WORK);
  run(list, 2);
  list.addObstacle({ ...ROAD_WORK, segment: 13 });
  run(list, 1);
  assert.deepEqual(list.items.map((o) => o.segment), [13]);
  assert.equal(list.ticksLeft(1), 2);
  assert.equal(list.ticksLeft(0), undefined);
});

test("in a pause no time passes and nothing ends", () => {
  const { list, clock, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  list.addObstacle(ROAD_WORK);
  run(list, 1);
  clock.clockRunning = false;
  const v = list.version;
  run(list, 1000);
  assert.equal(list.ticks, 1);
  assert.equal(list.items.length, 1);
  assert.equal(list.version, v);
  assert.equal(list.ticksLeft(0), 2);
  clock.clockRunning = true;
  run(list, 1);
  assert.equal(list.items.length, 1);
  run(list, 1);
  assert.equal(list.items.length, 0);
});

test("an obstacle added during a pause starts counting when the game goes on", () => {
  const { list, clock, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  clock.clockRunning = false;
  list.addObstacle(ROAD_WORK);
  run(list, 50);
  assert.equal(list.ticksLeft(0), 3);
});

test("the list that is given out cannot be changed", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  const [o] = list.items;
  assert.throws(() => {
    (o as { lane: number }).lane = 3;
  }, TypeError);
  list.items.pop();
  assert.equal(list.items.length, 1);
});

test("clear empties the list, restarts ids and time, and the version never goes down", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  run(list, 4);
  const v = list.version;
  list.clear();
  assert.equal(list.items.length, 0);
  assert.equal(list.ticks, 0);
  assert.equal(list.version, v + 1);
  list.clear();
  assert.equal(list.version, v + 1);
  assert.deepEqual(list.addObstacle(ROAD_WORK), { ok: true, id: 0 });
});

test("the random spawner and the earthquake can give their own source and time", () => {
  const { list } = setup();
  assert.deepEqual(list.add({ ...ROAD_WORK, source: "quake", durationTicks: 40 }), { ok: true, id: 0 });
  assert.equal(list.items[0]!.source, "quake");
  assert.equal(list.items[0]!.endTick, 40);
  assert.deepEqual(list.add({ ...ROAD_WORK, durationTicks: 0 }), { ok: false, error: "bad_duration" });
  assert.deepEqual(list.add({ ...ROAD_WORK, durationTicks: Number.NaN }), { ok: false, error: "bad_duration" });
});

test("the same calls give the same list and version", () => {
  function play() {
    const { list, params } = setup();
    params.set("obstacles.road_work.duration_s", 0.2);
    list.addObstacle(ROAD_WORK);
    run(list, 3);
    list.closeRoad(7);
    list.addObstacle({ type: "puddle", segment: 1, lane: 2, pos: 0.25 });
    list.removeObstacle(0);
    run(list, 10);
    return { items: list.items, version: list.version, ticks: list.ticks };
  }
  assert.deepEqual(play(), play());
});

test("it has the three calls that HazardControl of PR #61 uses for the list, with the same arguments", () => {
  const { list } = setup();
  const control: { addObstacle: unknown; removeObstacle: unknown; closeRoad: unknown } = list;
  for (const name of ["addObstacle", "removeObstacle", "closeRoad"] as const) {
    assert.equal(typeof control[name], "function", name);
  }
  // The admin handler passes exactly these four fields, with a type from its own list.
  for (const type of OBSTACLE_TYPES) {
    const r = list.addObstacle({ type, segment: 3, lane: 1, pos: 0.5 });
    assert.equal(r.ok, true, type);
  }
});
