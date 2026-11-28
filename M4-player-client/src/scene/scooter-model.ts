import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const SCOOTER_URL = "./models/scooter.glb";
export const SCOOTER_NODES = ["Body", "Chassis", "Fork", "FrontWheel", "RearWheel", "Rider", "Head", "TailLight"] as const;
export const TEAM_PAINT = "TeamPaint";

export type ScooterNode = (typeof SCOOTER_NODES)[number];

let template: THREE.Object3D | null = null;

export function scooterTemplate(): THREE.Object3D | null {
  return template;
}

export function useScooterTemplate(root: THREE.Object3D | null): void {
  if (root) {
    const missing = SCOOTER_NODES.filter((n) => !root.getObjectByName(n));
    if (missing.length) throw new Error(`scooter model misses nodes: ${missing.join(", ")}`);
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
  }
  template = root;
}

export async function loadScooter(url = SCOOTER_URL): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene.getObjectByName("Scooter") ?? gltf.scene;
  useScooterTemplate(root);
  return root;
}
