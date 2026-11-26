// Data of the delivery part of M1 (M1-3, issue #31).
// Coordinates are the ones of contracts/: metres, x to the east, z to the south.

/** The parameter registry of M1-5 (ParamRegistry.get): an unknown name throws. */
export interface ParamSource {
  get(name: string): number;
}

/** The shared seeded random numbers of M1-1: a number in [0, 1). */
export interface RandomSource {
  next(): number;
}

/** The part of contracts/city_plan.json that deliveries use. */
export interface DeliveryCityPlan {
  grid: { lanes_per_direction: number; lane_width_m: number };
  nodes: { id: number; x: number; z: number }[];
  segments: { id: number; a: number; b: number }[];
  stores: { team: number; pickup: { x: number; z: number; radius_m: number } }[];
  delivery_candidates: { id: number; segment: number; t: number; side: string }[];
}

/** Travel time table of one team (M3 -> M1, contracts/messages.md). null = cannot be reached. */
export interface TravelTimeTable {
  team: number;
  times_s: Record<string, number | null>;
}

/** What deliveries need to know about a player in one tick. */
export interface PlayerView {
  id: number;
  team: number;
  x: number;
  z: number;
  /** m/s */
  speed: number;
  fallen: boolean;
}

export interface Point {
  x: number;
  z: number;
}

/** The delivery state of one player, as it goes into the game state. */
export interface PlayerDelivery {
  hasPackage: boolean;
  /** The chosen delivery point, or null without a package. */
  candidate: number | null;
  /** Points of the chosen point, fixed when it was chosen. */
  points: number;
  /** Expected travel time of the chosen point, s. */
  expectedTime_s: number;
  /** Where the compass arrow points: the delivery point with a package, otherwise the own store. */
  compassTarget: Point;
  /** Seconds until "Find me" can be pressed again (0 = now). */
  findMeWait_s: number;
  /** True while the LED of the player flashes white on the board. */
  findMeActive: boolean;
}

export type DeliveryEvent =
  | { type: "picked_up"; player: number; team: number; candidate: number; points: number; far: boolean }
  | { type: "delivered"; player: number; team: number; candidate: number; points: number; time_s: number }
  | { type: "find_me"; player: number };
