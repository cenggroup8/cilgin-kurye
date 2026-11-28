import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { BikeModel, shownLean } from "../../src/scene/bike.ts";
import { chaseSpot } from "../../src/scene/camera.ts";
import { CarLayer } from "../../src/scene/cars.ts";
import { buildCity } from "../../src/scene/city.ts";
import { forwardOf, playerColor, roadWidth, yawOf } from "../../src/scene/pose.ts";
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

test("the town stays on the building footprints of the plan and under their heights", () => {
  const city = buildCity(plan);
  const solid = city.buildings.filter((m) => /town-(houseWall|aptWall|aptShop|glass|roofTile|roofFlat|door)/.test(m.name));
  assert.ok(solid.length >= 5, solid.map((m) => m.name).join());
  const inside = (poly: readonly (readonly number[])[], x: number, z: number) => {
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    return x >= Math.min(...xs) - 1 && x <= Math.max(...xs) + 1 && z >= Math.min(...zs) - 1 && z <= Math.max(...zs) + 1;
  };
  const p = new THREE.Vector3();
  for (const m of solid) {
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const home = plan.buildings.find((b) => inside(b.footprint, p.x, p.z));
      assert.ok(home, `${m.name} vertex outside every block at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      assert.ok(p.y <= home!.height_m + 0.6, `${m.name} too high in block ${home!.id}: ${p.y}`);
    }
  }
  assert.ok(city.triangles > 1000 && city.triangles < 60000, `${city.triangles} triangles`);
});

test("the town is a handful of draw calls, one per surface type", () => {
  const city = buildCity(plan);
  assert.ok(city.buildings.length <= 14, `${city.buildings.length} meshes`);
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

test("traffic lights stand at the crossings, lamps along the roads, and the lights change", () => {
  const city = buildCity(plan);
  assert.ok(city.props.signals.length >= 100);
  assert.ok(city.props.lamps.length >= 100);
  const bulbs = city.props.group.getObjectByName("signal-bulbs") as THREE.InstancedMesh;
  const c = new THREE.Color();
  const lit = () => {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      bulbs.getColorAt(i, c);
      out.push(c.getHexString());
    }
    return out.join();
  };
  city.props.update(1);
  const first = lit();
  city.props.update(8);
  assert.notEqual(lit(), first);
});

test("the chase camera is behind and above the motorcycle and looks ahead", () => {
  for (const heading of [0, 90, 200]) {
    const f = forwardOf(heading);
    const { eye, look } = chaseSpot({ x: 100, z: 50, heading, speed: 10 });
    assert.ok((eye.x - 100) * f.x + (eye.z - 50) * f.z < -3);
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
  const pose: ScenePlayer = { id: 0, team: 1, tone: 0, x: 10, z: 20, heading: 90, lean: 0, speed: 8, sliding: false, fallen: false };
  bike.update(pose, 1 / 60);
  assert.equal(bike.root.position.x, 10);
  assert.equal(bike.root.position.z, 20);
  bike.update({ ...pose, lean: 0.4 }, 1 / 60);
  const first = -bike.body.rotation.z;
  assert.ok(first > 0 && first < 0.05, `no jump: ${first}`);
  for (let i = 0; i < 120; i++) bike.update({ ...pose, lean: 0.4 }, 1 / 60);
  close(-bike.body.rotation.z, shownLean(0.4), 0.02);
  for (let i = 0; i < 120; i++) bike.update({ ...pose, lean: 0.79 }, 1 / 60);
  assert.ok(-bike.body.rotation.z < 0.43, "a hard turn leans less than 25 degrees");
  const head = new THREE.Vector3(0, 2, 0).applyEuler(bike.body.rotation);
  assert.ok(head.x > 0);
  for (let i = 0; i < 120; i++) bike.update({ ...pose, fallen: true }, 1 / 60);
  assert.ok(Math.abs(bike.body.rotation.z) > 1.2);
});

test("the scooter is cheap to draw: few meshes, shared shapes per team, real size", () => {
  const a = new BikeModel(2, 1);
  const b = new BikeModel(2, 1);
  const meshes: THREE.Mesh[] = [];
  a.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
  assert.ok(meshes.length <= 10, `${meshes.length} meshes`);
  const other: THREE.Mesh[] = [];
  b.root.traverse((o) => o instanceof THREE.Mesh && other.push(o));
  meshes.forEach((m, i) => assert.equal(m.geometry, other[i].geometry));
  a.update({ id: 0, team: 2, tone: 1, x: 0, z: 0, heading: 0, lean: 0, speed: 0, sliding: false, fallen: false }, 1 / 60);
  a.root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(a.root);
  close(size.min.y, 0, 0.02);
  assert.ok(size.max.y > 1.6 && size.max.y < 1.9, `height ${size.max.y}`);
  const length = size.max.z - size.min.z;
  assert.ok(length > 1.7 && length < 2.1, `length ${length}`);
});

test("eight liveries: a light and a dark tone for each team, from the board contract", () => {
  const seen = new Set<string>();
  for (let team = 0; team < 4; team++) for (const tone of [0, 1]) seen.add(playerColor(team, tone));
  assert.equal(seen.size, 8);
  for (let team = 0; team < 4; team++) {
    const light = new THREE.Color(playerColor(team, 0)).getHSL({ h: 0, s: 0, l: 0 }).l;
    const dark = new THREE.Color(playerColor(team, 1)).getHSL({ h: 0, s: 0, l: 0 }).l;
    assert.ok(light > dark);
  }
});
