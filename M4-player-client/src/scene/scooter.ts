import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const WHEEL_R = 0.27;
export const WHEELBASE = 1.3;
export const REAR_AXLE = new THREE.Vector3(0, WHEEL_R, WHEELBASE / 2);
export const FRONT_AXLE = new THREE.Vector3(0, WHEEL_R, -WHEELBASE / 2);
export const STEER_HEAD = new THREE.Vector3(0, 0.98, -0.4);
export const HIPS = new THREE.Vector3(0, 0.84, 0.3);
export const NECK = new THREE.Vector3(0, 1.43, 0.13);

const C = {
  tyre: "#1c1d21",
  rim: "#b9c0ca",
  steel: "#8d96a3",
  dark: "#2a2d33",
  seat: "#1f1a17",
  shield: "#f2efe8",
  glass: "#1c2733",
  mirror: "#cfe3f2",
  plate: "#f6f1df",
  brake: "#d63a2a",
  box: "#f7f3ea",
  stripe: "#ff7b1c",
  pants: "#2c3443",
  shoe: "#202227",
  glove: "#25272c",
  skin: "#d9a07a",
  reflect: "#dfe5ea",
  headlight: "#fff6d6",
  amber: "#ffb13b",
};

type G = THREE.BufferGeometry;

function prep(g: G, color: string): G {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function place(g: G, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): G {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
  return g.applyMatrix4(m);
}

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): G {
  return place(prep(new THREE.BoxGeometry(w, h, d), color), x, y, z, rx, ry, rz);
}

function blob(sx: number, sy: number, sz: number, color: string, x: number, y: number, z: number, detail = 1, rx = 0): G {
  const g = prep(new THREE.IcosahedronGeometry(1, detail), color);
  g.scale(sx, sy, sz);
  return place(g, x, y, z, rx);
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number, color: string, seg = 6): G {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = prep(new THREE.CylinderGeometry(r2, r1, len, seg), color);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
}

function disc(r: number, depth: number, color: string, x: number, y: number, z: number, seg = 12, axis: "x" | "z" = "x"): G {
  const g = prep(new THREE.CylinderGeometry(r, r, depth, seg), color);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  else g.rotateX(Math.PI / 2);
  return place(g, x, y, z);
}

function arc(r: number, width: number, start: number, length: number, color: string, x: number, y: number, z: number): G {
  const g = prep(new THREE.CylinderGeometry(r, r, width, 10, 1, true, start, length), color);
  g.rotateZ(Math.PI / 2);
  return place(g, x, y, z);
}

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

function merge(list: G[], origin: THREE.Vector3): G {
  const g = mergeGeometries(list, false)!;
  g.translate(-origin.x, -origin.y, -origin.z);
  g.computeBoundingSphere();
  return g;
}

export interface ScooterGeometry {
  frame: G;
  frameLights: G;
  tail: G;
  rearWheel: G;
  fork: G;
  forkLights: G;
  frontWheel: G;
  rider: G;
  head: G;
}

function wheel(front: boolean): G {
  const parts = [
    place(prep(new THREE.TorusGeometry(WHEEL_R - 0.055, 0.058, 6, 16), C.tyre).rotateY(Math.PI / 2), 0, 0, 0),
    disc(0.165, 0.1, C.rim, 0, 0, 0, 10),
    disc(0.06, 0.14, C.dark, 0, 0, 0, 8),
    box(0.11, 0.3, 0.035, C.steel, 0, 0, 0),
    box(0.11, 0.035, 0.3, C.steel, 0, 0, 0),
  ];
  if (front) parts.push(disc(0.12, 0.012, C.steel, -0.07, 0, 0, 14));
  else parts.push(disc(0.11, 0.05, C.dark, 0.07, 0, 0, 10));
  return merge(parts, v(0, 0, 0));
}

function shade(color: string, k: number): string {
  return `#${new THREE.Color(color).multiplyScalar(k).getHexString()}`;
}

export function buildScooter(team: string): ScooterGeometry {
  const jacket = shade(team, 0.55);
  const frame: G[] = [];
  const lights: G[] = [];
  const zR = REAR_AXLE.z;

  frame.push(
    box(0.38, 0.07, 0.62, C.dark, 0, 0.33, -0.1),
    box(0.4, 0.03, 0.64, C.steel, 0, 0.37, -0.1),
    box(0.42, 0.2, 0.62, team, 0, 0.43, 0.42),
    place(prep(new THREE.CapsuleGeometry(0.2, 0.46, 3, 10).rotateX(Math.PI / 2).scale(1.08, 0.92, 1), team), 0, 0.53, 0.46),
    box(0.31, 0.1, 0.6, C.seat, 0, 0.76, 0.36, -0.04),
    box(0.33, 0.035, 0.62, C.dark, 0, 0.71, 0.36, -0.04),
    box(0.16, 0.15, 0.48, C.dark, -0.13, 0.29, zR - 0.08),
    tube(v(0.17, 0.3, zR - 0.15), v(0.19, 0.38, zR + 0.27), 0.05, 0.045, C.steel, 8),
    box(0.06, 0.1, 0.16, C.dark, 0.2, 0.4, zR + 0.22),
    arc(WHEEL_R + 0.05, 0.14, 0.15 * Math.PI, 0.45 * Math.PI, C.dark, 0, WHEEL_R, zR),
    box(0.17, 0.11, 0.012, C.plate, 0, 0.42, zR + 0.27, 0.3),
    box(0.04, 0.12, 0.04, C.dark, 0, 0.5, zR + 0.22),
  );
  lights.push(
    box(0.06, 0.04, 0.03, C.amber, 0.17, 0.62, zR + 0.18),
    box(0.06, 0.04, 0.03, C.amber, -0.17, 0.62, zR + 0.18),
  );

  frame.push(
    box(0.4, 0.03, 0.38, C.steel, 0, 0.84, zR + 0.12),
    tube(v(0.16, 0.7, zR - 0.05), v(0.16, 0.84, zR + 0.12), 0.015, 0.015, C.steel, 5),
    tube(v(-0.16, 0.7, zR - 0.05), v(-0.16, 0.84, zR + 0.12), 0.015, 0.015, C.steel, 5),
    box(0.5, 0.42, 0.46, C.box, 0, 1.07, zR + 0.12),
    box(0.52, 0.05, 0.48, C.box, 0, 1.3, zR + 0.12),
    box(0.505, 0.07, 0.465, C.stripe, 0, 1.0, zR + 0.12),
    box(0.505, 0.012, 0.465, C.dark, 0, 1.27, zR + 0.12),
    box(0.16, 0.16, 0.01, team, 0, 1.12, zR + 0.355),
  );

  frame.push(
    box(0.44, 0.6, 0.05, team, 0, 0.66, -0.36, 0.2),
    box(0.38, 0.52, 0.03, C.shield, 0, 0.64, -0.325, 0.2),
    box(0.3, 0.1, 0.24, team, 0, 0.38, -0.36),
    box(0.1, 0.16, 0.05, C.dark, 0, 0.86, -0.43, 0.2),
  );

  const legs = (side: number): G[] => {
    const hip = v(side * 0.1, 0.84, 0.3);
    const knee = v(side * 0.14, 0.82, -0.06);
    const ankle = v(side * 0.14, 0.43, -0.12);
    return [
      tube(hip, knee, 0.075, 0.062, C.pants, 7),
      tube(knee, ankle, 0.058, 0.048, C.pants, 7),
      blob(0.07, 0.07, 0.07, C.pants, knee.x, knee.y, knee.z, 0),
      box(0.1, 0.08, 0.22, C.shoe, ankle.x, 0.41, -0.16),
    ];
  };
  frame.push(...legs(1), ...legs(-1), box(0.3, 0.14, 0.26, C.pants, 0, 0.84, 0.32));

  const fork: G[] = [];
  const forkLights: G[] = [];
  fork.push(
    tube(v(0, 0.48, -0.44), v(0, 1.0, -0.38), 0.045, 0.045, C.dark, 6),
    box(0.3, 0.13, 0.2, team, 0, 1.02, -0.4),
    box(0.16, 0.05, 0.1, C.dark, 0, 1.1, -0.36, -0.4),
    tube(v(0.06, 0.55, -0.5), v(0.07, WHEEL_R, FRONT_AXLE.z), 0.03, 0.03, C.steel, 6),
    tube(v(-0.06, 0.55, -0.5), v(-0.07, WHEEL_R, FRONT_AXLE.z), 0.03, 0.03, C.steel, 6),
    box(0.16, 0.12, 0.14, C.dark, 0, 0.52, -0.48),
    arc(WHEEL_R + 0.035, 0.16, 0.42 * Math.PI, 0.5 * Math.PI, team, 0, WHEEL_R, FRONT_AXLE.z),
    box(0.04, 0.07, 0.05, C.brake, -0.09, WHEEL_R + 0.08, FRONT_AXLE.z + 0.06),
    tube(v(-0.31, 1.04, -0.33), v(0.31, 1.04, -0.33), 0.017, 0.017, C.steel, 6),
    tube(v(-0.34, 1.04, -0.33), v(-0.24, 1.04, -0.33), 0.027, 0.027, C.dark, 6),
    tube(v(0.24, 1.04, -0.33), v(0.34, 1.04, -0.33), 0.027, 0.027, C.dark, 6),
    box(0.13, 0.012, 0.022, C.steel, 0.27, 1.05, -0.38, 0, 0.15),
    box(0.13, 0.012, 0.022, C.steel, -0.27, 1.05, -0.38, 0, -0.15),
    tube(v(0.22, 1.05, -0.35), v(0.3, 1.25, -0.37), 0.008, 0.008, C.steel, 4),
    tube(v(-0.22, 1.05, -0.35), v(-0.3, 1.25, -0.37), 0.008, 0.008, C.steel, 4),
    disc(0.045, 0.02, C.dark, 0.31, 1.27, -0.37, 10, "z"),
    disc(0.045, 0.02, C.dark, -0.31, 1.27, -0.37, 10, "z"),
    disc(0.037, 0.022, C.mirror, 0.31, 1.27, -0.365, 10, "z"),
    disc(0.037, 0.022, C.mirror, -0.31, 1.27, -0.365, 10, "z"),
  );
  forkLights.push(disc(0.07, 0.04, C.headlight, 0, 1.02, -0.5, 12, "z"), box(0.05, 0.03, 0.03, C.amber, 0.14, 1.02, -0.5), box(0.05, 0.03, 0.03, C.amber, -0.14, 1.02, -0.5));

  const rider: G[] = [];
  const shoulder = (side: number) => v(side * 0.2, 1.35, 0.17);
  const elbow = (side: number) => v(side * 0.25, 1.14, -0.05);
  const grip = (side: number) => v(side * 0.29, 1.05, -0.32);
  const torso = prep(new THREE.CylinderGeometry(0.2, 0.165, 0.56, 7), jacket);
  torso.scale(1, 1, 0.72);
  rider.push(place(torso, 0, 1.12, 0.24, -0.26));
  const stripe = prep(new THREE.CylinderGeometry(0.205, 0.19, 0.045, 7), C.reflect);
  stripe.scale(1, 1, 0.74);
  rider.push(place(stripe, 0, 1.06, 0.255, -0.26));
  rider.push(blob(0.2, 0.08, 0.13, jacket, 0, 1.36, 0.17, 0));
  const vest = prep(new THREE.CylinderGeometry(0.203, 0.168, 0.2, 7), team);
  vest.scale(1, 1, 0.73);
  rider.push(place(vest, 0, 1.25, 0.21, -0.26));
  for (const side of [1, -1]) {
    rider.push(
      blob(0.075, 0.075, 0.075, jacket, shoulder(side).x, shoulder(side).y, shoulder(side).z, 0),
      tube(shoulder(side), elbow(side), 0.058, 0.05, jacket, 6),
      tube(elbow(side), grip(side), 0.048, 0.04, jacket, 6),
      blob(0.05, 0.045, 0.06, C.glove, grip(side).x, grip(side).y, grip(side).z, 0),
    );
  }
  rider.push(tube(v(0, 1.36, 0.15), v(0, 1.48, 0.12), 0.055, 0.05, C.skin, 6));

  const head: G[] = [
    blob(0.17, 0.175, 0.19, C.shield, 0, 0.13, 0, 1),
    blob(0.145, 0.09, 0.08, C.glass, 0, 0.125, -0.14, 1),
    box(0.2, 0.06, 0.08, C.shield, 0, 0.03, -0.12),
    box(0.035, 0.21, 0.3, team, 0, 0.2, 0.01),
    blob(0.11, 0.1, 0.11, C.skin, 0, 0.04, 0.01, 0),
  ];

  return {
    frame: merge(frame, REAR_AXLE),
    frameLights: merge(lights, REAR_AXLE),
    tail: merge([box(0.15, 0.05, 0.03, "#ffffff", 0, 0.6, zR + 0.23)], REAR_AXLE),
    rearWheel: wheel(false),
    fork: merge(fork, STEER_HEAD),
    forkLights: merge(forkLights, STEER_HEAD),
    frontWheel: wheel(true),
    rider: merge(rider, HIPS),
    head: merge(head, v(0, 0, 0)),
  };
}
