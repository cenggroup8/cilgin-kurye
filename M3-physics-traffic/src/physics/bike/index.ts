/** The two stages of the motorcycle model (M3-1). */
import type { PhysicsStages } from '../step.js';
import { gripAndSliding } from './motion.js';
import { speedAndSteering } from './model.js';

export const BIKE_STAGES: Pick<PhysicsStages, 'speedAndSteering' | 'gripAndSliding'> = {
  speedAndSteering,
  gripAndSliding,
};

export { maxWheelAngle, nextSpeed, wantedTurnRate } from './model.js';
export { applyGrip, wrapAngle } from './motion.js';
export { DEFAULT_BIKE_TUNING, G } from './tuning.js';
export type { BikeTuning } from './tuning.js';
