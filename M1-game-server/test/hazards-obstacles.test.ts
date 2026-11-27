import { expect, it } from "vitest";
import { OBSTACLE_TYPES, type Obstacle } from "../src/hazards/estimates.js";
import { ObstacleList } from "../src/hazards/obstacles.js";
import { FakeClock, FakeParams, TPS } from "./hazards-fakes.js";

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

it("a new obstacle gets an id, an end time from its parameter, and raises the version", () => {
  const { list } = setup();
  expect(list.version).toBe(0);
  const r = list.addObstacle(ROAD_WORK);
  expect(r).toStrictEqual({ ok: true, id: 0 });
  expect(list.version).toBe(1);
  const [o] = list.items;
  expect(o).toStrictEqual({ id: 0, type: "road_work", segment: 12, lane: 1, pos: 0.5, source: "admin", endTick: 30 * TPS });
});

it("ids count up and every change raises the version by one", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  list.addObstacle({ ...ROAD_WORK, segment: 13 });
  list.removeObstacle(0);
  expect(list.items.map((o) => o.id)).toStrictEqual([1]);
  expect(list.version).toBe(3);
});

it("a wrong obstacle is refused and changes nothing", () => {
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
    expect(list.addObstacle(input as never)).toStrictEqual({ ok: false, error });
  }
  expect(list.items.length).toBe(0);
  expect(list.version).toBe(0);
});

it("every road of the city plan and the edges of lane and position are accepted", () => {
  const { list } = setup();
  expect(list.addObstacle({ ...ROAD_WORK, segment: 0, lane: 0, pos: 0 }).ok).toBe(true);
  expect(list.addObstacle({ ...ROAD_WORK, segment: 59, lane: 4, pos: 1 }).ok).toBe(true);
});

it("removing an unknown id is refused and does not raise the version", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  expect(list.removeObstacle(7)).toStrictEqual({ ok: false, error: "unknown_obstacle" });
  expect(list.version).toBe(1);
  expect(list.removeObstacle(0)).toStrictEqual({ ok: true });
  expect(list.items.length).toBe(0);
  expect(list.version).toBe(2);
});

it("close road puts road work on the whole segment, once", () => {
  const { list } = setup();
  const first = list.closeRoad(20);
  expect(first).toStrictEqual({ ok: true, id: 0 });
  expect(list.items[0]).toStrictEqual({ id: 0, type: "road_work", segment: 20, lane: 0, pos: 0.5, source: "admin", endTick: 900 });
  const again = list.closeRoad(20);
  expect(again).toStrictEqual({ ok: true, id: 0 });
  expect(list.items.length).toBe(1);
  expect(list.version).toBe(1);
  expect(list.closeRoad(60)).toStrictEqual({ ok: false, error: "unknown_road" });
});

it("the time of an obstacle comes from the parameter of its type", () => {
  const { list, params } = setup();
  params.set("obstacles.puddle.duration_s", 10);
  params.set("obstacles.accident.duration_s", 0.5);
  list.addObstacle({ ...ROAD_WORK, type: "puddle" });
  list.addObstacle({ ...ROAD_WORK, type: "accident" });
  expect(list.items.map((o) => o.endTick)).toStrictEqual([10 * TPS, 15]);
});

it("a changed parameter does not change an obstacle that is already there", () => {
  const { list, params } = setup();
  list.addObstacle(ROAD_WORK);
  params.set("obstacles.road_work.duration_s", 5);
  list.addObstacle({ ...ROAD_WORK, segment: 14 });
  expect(list.items.map((o) => o.endTick)).toStrictEqual([900, 150]);
});

it("an obstacle ends exactly at its end time and the version goes up once", () => {
  const { list, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1); // 3 ticks
  list.addObstacle(ROAD_WORK);
  const v = list.version;
  run(list, 2);
  expect(list.items.length).toBe(1);
  expect(list.version).toBe(v);
  const ended = list.tick();
  expect(ended.map((o) => o.id)).toStrictEqual([0]);
  expect(list.items.length).toBe(0);
  expect(list.version).toBe(v + 1);
  run(list, 5);
  expect(list.version).toBe(v + 1);
});

it("two obstacles that end in the same tick raise the version once", () => {
  const { list, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  list.addObstacle(ROAD_WORK);
  list.addObstacle({ ...ROAD_WORK, segment: 13 });
  const v = list.version;
  run(list, 3);
  expect(list.items.length).toBe(0);
  expect(list.version).toBe(v + 1);
});

it("an obstacle added later ends later", () => {
  const { list, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  list.addObstacle(ROAD_WORK);
  run(list, 2);
  list.addObstacle({ ...ROAD_WORK, segment: 13 });
  run(list, 1);
  expect(list.items.map((o) => o.segment)).toStrictEqual([13]);
  expect(list.ticksLeft(1)).toBe(2);
  expect(list.ticksLeft(0)).toBe(undefined);
});

it("in a pause no time passes and nothing ends", () => {
  const { list, clock, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  list.addObstacle(ROAD_WORK);
  run(list, 1);
  clock.clockRunning = false;
  const v = list.version;
  run(list, 1000);
  expect(list.ticks).toBe(1);
  expect(list.items.length).toBe(1);
  expect(list.version).toBe(v);
  expect(list.ticksLeft(0)).toBe(2);
  clock.clockRunning = true;
  run(list, 1);
  expect(list.items.length).toBe(1);
  run(list, 1);
  expect(list.items.length).toBe(0);
});

it("an obstacle added during a pause starts counting when the game goes on", () => {
  const { list, clock, params } = setup();
  params.set("obstacles.road_work.duration_s", 0.1);
  clock.clockRunning = false;
  list.addObstacle(ROAD_WORK);
  run(list, 50);
  expect(list.ticksLeft(0)).toBe(3);
});

it("the list that is given out cannot be changed", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  const [o] = list.items;
  expect(() => {
    (o as { lane: number }).lane = 3;
  }).toThrow(TypeError);
  (list.items as Obstacle[]).pop();
  expect(list.items.length).toBe(1);
});

it("clear empties the list, restarts ids and time, and the version never goes down", () => {
  const { list } = setup();
  list.addObstacle(ROAD_WORK);
  run(list, 4);
  const v = list.version;
  list.clear();
  expect(list.items.length).toBe(0);
  expect(list.ticks).toBe(0);
  expect(list.version).toBe(v + 1);
  list.clear();
  expect(list.version).toBe(v + 1);
  expect(list.addObstacle(ROAD_WORK)).toStrictEqual({ ok: true, id: 0 });
});

it("the random spawner and the earthquake can give their own source and time", () => {
  const { list } = setup();
  expect(list.add({ ...ROAD_WORK, source: "quake", durationTicks: 40 })).toStrictEqual({ ok: true, id: 0 });
  expect(list.items[0]!.source).toBe("quake");
  expect(list.items[0]!.endTick).toBe(40);
  expect(list.add({ ...ROAD_WORK, durationTicks: 0 })).toStrictEqual({ ok: false, error: "bad_duration" });
  expect(list.add({ ...ROAD_WORK, durationTicks: Number.NaN })).toStrictEqual({ ok: false, error: "bad_duration" });
});

it("the same calls give the same list and version", () => {
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
  expect(play()).toStrictEqual(play());
});

it("it has the three calls that HazardControl of PR #61 uses for the list, with the same arguments", () => {
  const { list } = setup();
  const control: { addObstacle: unknown; removeObstacle: unknown; closeRoad: unknown } = list;
  for (const name of ["addObstacle", "removeObstacle", "closeRoad"] as const) {
    expect(typeof control[name], name).toBe("function");
  }
  // The admin handler passes exactly these four fields, with a type from its own list.
  for (const type of OBSTACLE_TYPES) {
    const r = list.addObstacle({ type, segment: 3, lane: 1, pos: 0.5 });
    expect(r.ok, type).toBe(true);
  }
});
