/** The two stages of the motorcycle model (M3-1). */
import type { PhysicsStages } from '../step';
import { gripAndSliding } from './motion';
import { speedAndSteering } from './model';

export const BIKE_STAGES: Pick<PhysicsStages, 'speedAndSteering' | 'gripAndSliding'> = {
  speedAndSteering,
  gripAndSliding,
};

export { maxWheelAngle, nextSpeed, wantedTurnRate } from './model';
export { applyGrip, wrapAngle } from './motion';
export { DEFAULT_BIKE_TUNING, G } from './tuning';
export type { BikeTuning } from './tuning';
