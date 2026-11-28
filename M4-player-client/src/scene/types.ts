export interface CityPlan {
  world: { size_m: number };
  grid: { lines: number; pitch_m: number; lanes_per_direction: number; lane_width_m: number };
  nodes: readonly { id: number; x: number; z: number }[];
  segments: readonly { id: number; a: number; b: number }[];
  stores: readonly {
    team: number;
    color: string;
    pickup: { x: number; z: number; radius_m: number };
    depot?: { footprint: readonly (readonly number[])[]; height_m: number };
  }[];
  buildings: readonly { id: number; block?: string; kind?: string; footprint: readonly (readonly number[])[]; height_m: number }[];
}

export interface ScenePlayer {
  id: number;
  team: number;
  tone: number;
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

export type ObstacleType = "heavy_traffic" | "road_work" | "accident" | "puddle";

export interface SceneObstacle {
  id: number;
  type: ObstacleType;
  segment: number;
  lane: number;
  pos: number;
}

export interface SceneQuake {
  x: number;
  z: number;
  radius: number;
  magnitude: number;
}

export interface SceneState {
  self: number | null;
  players: readonly ScenePlayer[];
  cars: readonly SceneCar[];
  obstacles?: readonly SceneObstacle[];
  quake?: SceneQuake | null;
}
