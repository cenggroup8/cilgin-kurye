import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as THREE from "three";
import { BikeModel } from "../../src/scene/bike.ts";
import { SCOOTER_NODES, TEAM_PAINT, useScooterTemplate } from "../../src/scene/scooter-model.ts";

type Gltf = {
  nodes: { name: string; mesh?: number; matrix?: number[]; children?: number[] }[];
  meshes: { primitives: { material: number; indices?: number; attributes: { POSITION: number } }[] }[];
  materials: { name: string }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
};

function readGlb(path: string): Gltf {
  const buf = readFileSync(path);
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + length).toString("utf8"));
}

const glb = readGlb(new URL("../../assets/models/scooter.glb", import.meta.url).pathname);

test("the scooter file has every node the game moves, with 3 materials", () => {
  const names = glb.nodes.map((n) => n.name);
  for (const n of SCOOTER_NODES) assert.ok(names.includes(n), n);
  assert.deepEqual(glb.materials.map((m) => m.name).sort(), ["Atlas", "Lights", TEAM_PAINT].sort());
});

test("the scooter file stays inside the phone budget", () => {
  let tris = 0;
  for (const m of glb.meshes) {
    for (const p of m.primitives) tris += glb.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  }
  assert.ok(tris <= 4500, `${tris} triangles`);
  assert.ok(glb.meshes.length <= 12);
});

test("the pivots sit where the rig needs them: axles, steering head, hips", () => {
  const at = (name: string) => glb.nodes.find((n) => n.name === name)!.matrix!.slice(12, 15);
  assert.deepEqual(at("Chassis"), [0, 0.27, 0.65]);
  const fork = at("Fork");
  const front = at("FrontWheel");
  assert.ok(Math.abs(0.27 + fork[1] + front[1] - 0.27) < 1e-6 && Math.abs(0.65 + fork[2] + front[2] + 0.65) < 1e-6);
  const wheel = glb.nodes.find((n) => n.name === "RearWheel")!;
  const pos = glb.accessors[glb.meshes[wheel.mesh!].primitives[0].attributes.POSITION];
  assert.ok(Math.abs(pos.min![1] + 0.27) < 0.005, "tyre touches the ground");
});

test("a bike built from a model file moves the named nodes and gets its team paint", () => {
  const root = new THREE.Group();
  root.name = "Scooter";
  const make = (name: string, parent: THREE.Object3D, mesh = false) => {
    const o = mesh ? new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial({ name: name === "Frame" ? TEAM_PAINT : "Lights" })) : new THREE.Group();
    o.name = name;
    parent.add(o);
    return o;
  };
  const body = make("Body", root);
  const chassis = make("Chassis", body);
  make("Frame", chassis, true);
  make("TailLight", chassis, true);
  make("RearWheel", chassis, true);
  const fork = make("Fork", chassis);
  make("FrontWheel", fork, true);
  const rider = make("Rider", chassis);
  make("Head", rider, true);
  useScooterTemplate(root);
  try {
    const bike = new BikeModel(3, 1);
    assert.equal(bike.fromFile, true);
    const pose = { id: 0, team: 3, tone: 1, x: 5, z: 6, heading: 90, lean: 0.5, speed: 10, sliding: false, fallen: false };
    for (let i = 0; i < 90; i++) bike.update(pose, 1 / 60);
    assert.ok(bike.body.rotation.z < -0.1);
    assert.equal(bike.body.name, "Body");
    let paint: THREE.MeshStandardMaterial | null = null;
    bike.root.traverse((o) => {
      if (o.name === "Frame") paint = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    });
    assert.equal(paint!.color.getHexString(), new THREE.Color("#d28c00").getHexString());
  } finally {
    useScooterTemplate(null);
  }
});
