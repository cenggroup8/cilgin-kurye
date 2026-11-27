export const TEAM_COLORS = ["#3d7bff", "#2fbf71", "#9b5cff", "#f2c230"] as const;

export function teamColor(team: number): string {
  return TEAM_COLORS[team] ?? "#d0d4dc";
}

export function yawOf(headingDeg: number): number {
  return (-headingDeg * Math.PI) / 180;
}

export function forwardOf(headingDeg: number): { x: number; z: number } {
  const r = (headingDeg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

export function roadWidth(grid: { lanes_per_direction: number; lane_width_m: number }): number {
  return 2 * grid.lanes_per_direction * grid.lane_width_m;
}

export function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
