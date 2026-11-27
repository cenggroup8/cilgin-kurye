import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { BikeModel } from "../../src/scene/bike.ts";
import { chaseSpot } from "../../src/scene/camera.ts";
import { CarLayer } from "../../src/scene/cars.ts";
import { buildCity } from "../../src/scene/city.ts";
import { forwardOf, roadWidth, yawOf } from "../../src/scene/pose.ts";
import type { CityPlan, ScenePlayer } from "../../src/scene/types.ts";
import planJson from "./city_plan.json" with { type: "json" };

const plan = planJson as unknown as CityPlan;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("heading 0 looks north (-z) and 90 looks east (+x)", () => {
  close(forwardOf(0).x, 0);
  close(forwardOf(0).z, -1);
  close(forwardOf(90).x, 1);
  close(forwardOf(90).z, 0);
});

test("a model that looks down -z, turned by yawOf, looks along forwardOf", () => {
  for (const h of [0, 37, 90, 180, 251, 359]) {
    const v = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOf(h));
    close(v.x, forwardOf(h).x);
    close(v.z, forwardOf(h).z);
  }
});

test("the city has every building of the plan, at its height and on its footprint", () => {
  const city = buildCity(plan);
  assert.equal(city.buildings.length, plan.buildings.length);
  plan.buildings.forEach((b, i) => {
    const box = new THREE.Box3().setFromObject(city.buildings[i]);
    const xs = b.footprint.map((p) => p[0]);
    const zs = b.footprint.map((p) => p[1]);
    close(box.min.x, Math.min(...xs), 1e-6);
    close(box.max.x, Math.max(...xs), 1e-6);
    close(box.min.z, Math.min(...zs), 1e-6);
    close(box.max.z, Math.max(...zs), 1e-6);
    close(box.max.y, b.height_m + 0.5, 1e-6);
  });
});

test("one store per team at its pickup point", () => {
  const city = buildCity(plan);
  assert.equal(city.stores.length, 4);
  plan.stores.forEach((s, i) => {
    assert.equal(city.stores[i].position.x, s.pickup.x);
    assert.equal(city.stores[i].position.z, s.pickup.z);
  });
});

test("lane marks stay off the intersections", () => {
  const city = buildCity(plan);
  const half = roadWidth(plan.grid) / 2;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const mesh of city.markings) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const inside = plan.nodes.some((n) => Math.abs(p.x - n.x) < half && Math.abs(p.z - n.z) < half);
      assert.ok(!inside, `mark ${i} of ${mesh.name} at ${p.x}, ${p.z}`);
    }
  }
});

test("windows are drawn with one instanced mesh and stay below the roofs", () => {
  const city = buildCity(plan);
  assert.ok(city.windows.count > 500);
  const top = Math.max(...plan.buildings.map((b) => b.height_m));
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < city.windows.count; i++) {
    city.windows.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    assert.ok(p.y > 0 && p.y < top);
  }
});

test("the chase camera is behind and above the motorcycle and looks ahead", () => {
  for (const heading of [0, 90, 200]) {
    const f = forwardOf(heading);
    const { eye, look } = chaseSpot({ x: 100, z: 50, heading, speed: 10 });
    assert.ok((eye.x - 100) * f.x + (eye.z - 50) * f.z < -5);
    assert.ok((look.x - 100) * f.x + (look.z - 50) * f.z > 0);
    assert.ok(eye.y > 2);
  }
});

test("NPC cars use one draw call for any number of cars, up to the capacity", () => {
  const layer = new CarLayer(8);
  const car = (id: number) => ({ id, x: id * 10, z: 0, heading: 90, length: 4.5, width: 1.9, offroad: false });
  layer.update([car(1), car(2), car(3)]);
  const bodies = layer.group.getObjectByName("car-bodies") as THREE.InstancedMesh;
  assert.equal(bodies.count, 3);
  layer.update(Array.from({ length: 20 }, (_, i) => car(i)));
  assert.equal(bodies.count, 8);
});

test("the motorcycle leans smoothly to the right and lies down when it falls", () => {
  const bike = new BikeModel(1);
  const pose: ScenePlayer = { id: 0, team: 1, x: 10, z: 20, heading: 90, lean: 0, speed: 8, sliding: false, fallen: false };
  bike.update(pose, 1 / 60);
  assert.equal(bike.root.position.x, 10);
  assert.equal(bike.root.position.z, 20);
  bike.update({ ...pose, lean: 0.4 }, 1 / 60);
  const first = -bike.body.rotation.z;
  assert.ok(first > 0 && first < 0.1, `no jump: ${first}`);
  for (let i = 0; i < 120; i++) bike.update({ ...pose, lean: 0.4 }, 1 / 60);
  close(-bike.body.rotation.z, 0.4, 0.02);
  const head = new THREE.Vector3(0, 2, 0).applyEuler(bike.body.rotation);
  assert.ok(head.x > 0);
  for (let i = 0; i < 120; i++) bike.update({ ...pose, fallen: true }, 1 / 60);
  assert.ok(Math.abs(bike.body.rotation.z) > 1.2);
});
