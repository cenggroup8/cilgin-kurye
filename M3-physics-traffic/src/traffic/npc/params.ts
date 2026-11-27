/**
 * Traffic parameters: checks and the admin names of the M1 parameter registry
 * (M1-5, PR #61). Same idea as src/physics/params.ts.
 *
 * Admin parameters owned by M3-4 (proposal, the limits are in M1's param-list.ts):
 *   physics.npc_count              0-60,  start 20   number of normal NPC cars
 *   physics.npc_speed_mps          5-20,  start 11   speed of a free NPC car
 *   physics.npc_hit_stop_s         0-10,  start 2.5  how long a hit car stands still
 *   obstacles.heavy_traffic.effect 0-1,   start 0.5  extra cars and how slow they are
 * All other traffic parameters keep their start values (DEFAULT_TRAFFIC_PARAMS).
 */
import type { TrafficParams } from './types.js';

/** Most extra cars that one heavy traffic obstacle adds (effect = 1). */
export const HEAVY_TRAFFIC_MAX_EXTRA_CARS = 8;

/** Admin parameter name for each traffic parameter that the admin can change. */
export const TRAFFIC_PARAM_KEYS = {
  carCount: 'physics.npc_count',
  maxSpeed: 'physics.npc_speed_mps',
  hitStopTime: 'physics.npc_hit_stop_s',
  heavyTrafficEffect: 'obstacles.heavy_traffic.effect',
} as const;

/** Extra cars and their speed factor for a heavy traffic effect of 0..1. */
export function heavyTrafficFromEffect(effect: number): Pick<TrafficParams, 'heavyTrafficExtraCars' | 'heavyTrafficSpeedFactor'> {
  const e = Math.min(1, Math.max(0, effect));
  return {
    heavyTrafficExtraCars: Math.round(HEAVY_TRAFFIC_MAX_EXTRA_CARS * e),
    heavyTrafficSpeedFactor: 1 - 0.8 * e,
  };
}

/**
 * Turns admin changes, given by their registry names, into TrafficParams
 * changes for NpcTraffic.step({ params }). Names that are not traffic
 * parameters are ignored.
 */
export function trafficParamChanges(changes: Readonly<Record<string, number>>): Partial<TrafficParams> {
  const out: Partial<TrafficParams> = {};
  const k = TRAFFIC_PARAM_KEYS;
  if (changes[k.carCount] !== undefined) out.carCount = changes[k.carCount];
  if (changes[k.maxSpeed] !== undefined) out.maxSpeed = changes[k.maxSpeed];
  if (changes[k.hitStopTime] !== undefined) out.hitStopTime = changes[k.hitStopTime];
  if (changes[k.heavyTrafficEffect] !== undefined) Object.assign(out, heavyTrafficFromEffect(changes[k.heavyTrafficEffect]));
  return out;
}

/** Throws RangeError when a parameter has a value that NPC traffic cannot use. */
export function checkTrafficParams(p: TrafficParams): TrafficParams {
  const bad = (name: keyof TrafficParams) => {
    throw new RangeError(`Bad traffic parameter ${name}: ${p[name]}`);
  };
  const int = (name: keyof TrafficParams, min: number) => {
    if (!Number.isInteger(p[name]) || p[name] < min) bad(name);
  };
  const num = (name: keyof TrafficParams, min: number, minOpen = false) => {
    const v = p[name];
    if (!Number.isFinite(v) || v < min || (minOpen && v === min)) bad(name);
  };
  int('carCount', 0);
  num('maxSpeed', 0, true);
  int('heavyTrafficExtraCars', 0);
  num('heavyTrafficSpeedFactor', 0, true);
  if (p.heavyTrafficSpeedFactor > 1) bad('heavyTrafficSpeedFactor');
  num('minSpawnDistance', 0);
  num('stuckTimeout', 0, true);
  num('offroadImpactSpeed', 0);
  num('hitStopTime', 0);
  num('offroadTime', 0);
  int('maxSpawnPerTick', 1);
  int('maxDespawnPerTick', 1);
  return p;
}
