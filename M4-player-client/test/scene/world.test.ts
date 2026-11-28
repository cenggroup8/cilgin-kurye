import assert from "node:assert/strict";
import { test } from "node:test";
import { groundHeight, LAWN_TOP, SIDEWALK_TOP } from "../../src/scene/city.ts";
import { ObstacleLayer, placeObstacle } from "../../src/scene/obstacles.ts";
import { quakeShake } from "../../src/scene/scene.ts";
import { blendCar, lerpHeading, SnapshotBuffer } from "../../src/scene/snapshots.ts";
import type { CityPlan, SceneCar } from "../../src/scene/types.ts";
import planJson from "./city_plan.json" with { type: "json" };

const plan = planJson as unknown as CityPlan;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const car = (id: number, x: number, heading = 90): SceneCar => ({ id, x, z: 0, heading, length: 4.5, width: 1.9, offroad: false });

test("other riders and cars are drawn a little in the past, between two server states", () => {
  const feed = new SnapshotBuffer<SceneCar>(blendCar, 0.1);
  feed.push(0, [car(1, 0)], 10);
  feed.push(1 / 30, [car(1, 1)], 10 + 1 / 30);
  feed.push(2 / 30, [car(1, 2)], 10 + 2 / 30);
  const [c] = feed.sample(10 + 2 / 30 + 0.1 - 0.5 / 30);
  close(c.x, 1.5, 1e-6);
});

test("late or lost states do not make things jump: the newest pose is held", () => {
  const feed = new SnapshotBuffer<SceneCar>(blendCar, 0.1);
  feed.push(0, [car(1, 0)], 5);
  feed.push(1 / 30, [car(1, 1)], 5.2);
  feed.push(2 / 30, [car(1, 2)], 5.21);
  const [held] = feed.sample(9);
  close(held.x, 2);
  const [early] = feed.sample(0);
  close(early.x, 0);
});

test("a car that appears is drawn at once, one that left is gone", () => {
  const feed = new SnapshotBuffer<SceneCar>(blendCar, 0);
  feed.push(0, [car(1, 0), car(2, 5)], 0);
  feed.push(1, [car(1, 1), car(3, 9)], 1);
  const ids = feed.sample(0.5).map((c) => c.id).sort();
  assert.deepEqual(ids, [1, 3]);
});

test("headings blend the short way round", () => {
  close(lerpHeading(350, 10, 0.5), 0);
  close(lerpHeading(10, 350, 0.25), 5);
});

test("an obstacle sits on its segment, in its lane, right-hand traffic", () => {
  const east = placeObstacle(plan, { id: 1, type: "puddle", segment: 0, lane: 1, pos: 0.5 })!;
  close(east.x, 50);
  close(east.z, plan.grid.lane_width_m / 2);
  const back = placeObstacle(plan, { id: 2, type: "accident", segment: 0, lane: 4, pos: 0.25 })!;
  close(back.x, 25);
  close(back.z, -1.5 * plan.grid.lane_width_m);
  const south = placeObstacle(plan, { id: 3, type: "road_work", segment: 31, lane: 0, pos: 0.5 })!;
  close(south.x, 100);
  close(south.z, 50);
  assert.equal(placeObstacle(plan, { id: 4, type: "puddle", segment: 999, lane: 0, pos: 0 }), null);
});

test("obstacles are instanced and rebuilt only when the list changes", () => {
  const layer = new ObstacleLayer(plan);
  const list = [
    { id: 1, type: "road_work" as const, segment: 31, lane: 0, pos: 0.5 },
    { id: 2, type: "accident" as const, segment: 0, lane: 3, pos: 0.8 },
    { id: 3, type: "puddle" as const, segment: 0, lane: 1, pos: 0.5 },
    { id: 4, type: "heavy_traffic" as const, segment: 1, lane: 0, pos: 0.5 },
  ];
  layer.update(list);
  const c = layer.counts;
  assert.ok(c.cone > 8 && c.board >= 20 && c.body === 1 && c.puddle === 1, JSON.stringify(c));
  assert.equal(layer.group.children.length, 8);
  layer.update([]);
  assert.equal(layer.counts.cone, 0);
});

test("the earthquake shakes more near its centre and not at all far away", () => {
  const q = { x: 250, z: 250, radius: 140, magnitude: 7 };
  assert.ok(quakeShake(q, 250, 250) > quakeShake(q, 340, 250));
  assert.ok(quakeShake(q, 250, 250) <= 0.7 + 1e-9);
  assert.equal(quakeShake(q, 0, 0), 0);
  assert.equal(quakeShake(null, 250, 250), 0);
});

test("wheels stay on top: road 0, sidewalk and lawn at their own heights", () => {
  const at = groundHeight(plan);
  assert.equal(at(50, 0), 0);
  assert.equal(at(100, 50), 0);
  assert.equal(at(50, 8), SIDEWALK_TOP);
  assert.equal(at(18, 18), LAWN_TOP);
  assert.equal(at(-30, 50), 0);
});
