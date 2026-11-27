/** The collision solver and fall judge (M3-2). Each step of the package fills one more stage. */
import type { PhysicsStages } from '../step.js';
import { carsAndBikes } from './cars-and-bikes.js';
import { wallsAndObstacles } from './stages.js';

export { BIKE_RADIUS_M, OUTER_WALL_MARGIN_M, BARRIER_THICKNESS_M } from './constants.js';
export { judgeImpact, relativeNormalSpeed } from './fall-judge.js';
export type { Judgement } from './fall-judge.js';
export { wallsAndObstacles } from './stages.js';
export { carsAndBikes } from './cars-and-bikes.js';

/** The stages of M3-2 that exist so far. fallCheck stays empty until the next steps. */
export const COLLIDE_STAGES: Pick<PhysicsStages, 'wallsAndObstacles' | 'carsAndBikes'> = { wallsAndObstacles, carsAndBikes };
