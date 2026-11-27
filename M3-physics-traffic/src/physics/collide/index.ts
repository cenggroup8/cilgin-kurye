/** The collision solver and fall judge (M3-2). Each step of the package fills one more stage. */
import type { PhysicsStages } from '../step';
import { wallsAndObstacles } from './stages';

export { BIKE_RADIUS_M, OUTER_WALL_MARGIN_M, BARRIER_THICKNESS_M } from './constants';
export { judgeImpact, relativeNormalSpeed } from './fall-judge';
export type { Judgement } from './fall-judge';
export { wallsAndObstacles } from './stages';

/** The stages of M3-2 that exist so far. carsAndBikes and fallCheck stay empty until the next steps. */
export const COLLIDE_STAGES: Pick<PhysicsStages, 'wallsAndObstacles'> = { wallsAndObstacles };
