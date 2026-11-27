// TAHMİN: eksen ve açı kuralları M1-1 sahibinden (Berk) doğrulanana kadar.
//
// Poses come in the rule of the module that makes them. The compass needs one
// rule (`compass-model.ts`, the rule of `contracts/README.md`: x east, z south,
// heading in degrees clockwise from north). These small functions change a pose
// to that rule, and nothing else is done with the numbers here.
//
// Where each rule comes from:
//   - fromPredictorPose: PR #76 (M4-4), `predict/types.ts:5` and `stub-bike.ts:41-42`:
//     angle in radians, 0 = +Z, and a bike moves x += sin(angle), z += cos(angle).
//     This takes z as the south axis, like contracts; #76 does not say it.
//   - fromM3Pose / fromM3Target: PR #69 (M3-1), `common/coords.ts` and `types.ts`:
//     x east, y north, angle in radians, 0 = +x, counter clockwise positive.
//   - fromM1Pose: PR #78 (M1-1), `loop/types.ts:65-73` (`Pose { x, y, angle }`,
//     "radyan"). The axes and the zero of the angle are NOT written there; it is
//     asked in #78. Until the answer comes it is the same as fromM3Pose (guess).

export interface WorldPose {
  x: number;
  z: number;
  /** Degrees, clockwise from north, in [0, 360). */
  headingDeg: number;
}

const DEG = 180 / Math.PI;

/** Keeps an angle in [0, 360). */
function wrap360(degrees: number): number {
  const wrapped = (((degrees % 360) + 360) % 360);
  return wrapped === 0 ? 0 : wrapped;
}

/** Own pose that the predictor (M4-4, PR #76) draws: `{ x, z, angle }`, angle 0 = +Z. */
export function fromPredictorPose(pose: { x: number; z: number; angle: number }): WorldPose {
  return { x: pose.x, z: pose.z, headingDeg: wrap360(180 - pose.angle * DEG) };
}

/** Pose of M3 (PR #69): x east, y north, angle 0 = +x and counter clockwise. */
export function fromM3Pose(pose: { x: number; y: number; angle: number }): WorldPose {
  return { x: pose.x, z: 0 - pose.y, headingDeg: wrap360(90 - pose.angle * DEG) };
}

/** Pose from the game state of M1 (PR #78). TAHMİN: the rule is not written; same as M3 for now. */
export function fromM1Pose(pose: { x: number; y: number; angle: number }): WorldPose {
  return fromM3Pose(pose);
}

/** Target of the compass (`compassX`, `compassY` in PR #78). TAHMİN: same axes as the pose of M3. */
export function fromM3Target(target: { x: number; y: number }): { x: number; z: number } {
  return { x: target.x, z: 0 - target.y };
}
