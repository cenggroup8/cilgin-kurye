import type { PhysicsParams } from './types.js';

/** Start values, the same as in the M1 parameter registry (M1-5). */
export const DEFAULT_PHYSICS_PARAMS: Readonly<PhysicsParams> = {
  topSpeed: 15,
  grip: 1,
  gripPuddle: 0.4,
  gripQuake: 0.5,
  fallSpeed: 6,
};

/** Admin parameter name for each physics parameter (M1 parameter registry). */
export const PHYSICS_PARAM_KEYS: Readonly<Record<keyof PhysicsParams, string>> = {
  topSpeed: 'physics.top_speed_mps',
  grip: 'physics.grip',
  gripPuddle: 'physics.grip_puddle',
  gripQuake: 'quake.grip',
  fallSpeed: 'physics.fall_speed_mps',
};

/**
 * Applies admin changes given by their registry names. M1 has already checked
 * the limits. Names that are not physics parameters are ignored.
 */
export function applyParamChanges(
  params: PhysicsParams,
  changes: Readonly<Record<string, number>>,
): PhysicsParams {
  const next = { ...params };
  for (const field of Object.keys(PHYSICS_PARAM_KEYS) as (keyof PhysicsParams)[]) {
    const value = changes[PHYSICS_PARAM_KEYS[field]];
    if (value !== undefined) next[field] = value;
  }
  return next;
}
