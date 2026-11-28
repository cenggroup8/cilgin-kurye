// The six modules, their folders in the repository and who writes their adapter.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = join(BENCH_DIR, "..", "..");

export interface ModuleInfo {
  id: string; // folder name under adapters/ and scenarios/
  mod: string; // name in the records
  folder: string; // module folder in the repository
  title: string;
  owner: string; // who writes the adapter
}

export const MODULES: readonly ModuleInfo[] = [
  { id: "m1", mod: "M1", folder: "M1-game-server", title: "Game server and rules", owner: "Berk" },
  { id: "m2", mod: "M2", folder: "M2-network", title: "Network and synchronization", owner: "Umutcan" },
  { id: "m3", mod: "M3", folder: "M3-physics-traffic", title: "Physics and traffic", owner: "Muhib" },
  { id: "m4", mod: "M4", folder: "M4-player-client", title: "Player client", owner: "Berk" },
  { id: "m5", mod: "M5", folder: "M5-admin-panel", title: "Admin panel", owner: "Berk" },
  { id: "m6", mod: "M6", folder: "M6-led-board", title: "LED board and ESP32", owner: "Umutcan, Muhib" },
];

export function moduleById(id: string): ModuleInfo | undefined {
  const k = id.toLowerCase();
  return MODULES.find((m) => m.id === k || m.mod.toLowerCase() === k);
}
