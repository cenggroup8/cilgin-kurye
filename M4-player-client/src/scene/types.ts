export interface CityPlan {
  world: { size_m: number };
  grid: { lines: number; pitch_m: number; lanes_per_direction: number; lane_width_m: number };
  nodes: readonly { id: number; x: number; z: number }[];
  segments: readonly { id: number; a: number; b: number }[];
  stores: readonly { team: number; color: string; pickup: { x: number; z: number; radius_m: number } }[];
  buildings: readonly { id: number; footprint: readonly (readonly number[])[]; height_m: number }[];
}

export interface ScenePlayer {
  id: number;
  team: number;
  x: number;
  z: number;
  heading: number;
  lean: number;
  speed: number;
  sliding: boolean;
  fallen: boolean;
}

export interface SceneCar {
  id: number;
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  offroad: boolean;
}

export interface SceneState {
  self: number | null;
  players: readonly ScenePlayer[];
  cars: readonly SceneCar[];
}
