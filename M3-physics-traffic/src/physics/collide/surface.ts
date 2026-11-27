/**
 * The ground that the colliders give (M3-2, step 5): water puddle, slow zone of an accident and
 * the earthquake area. `colliderSurface(world, base)` gives a `SurfaceProvider` that takes the
 * ground of `base` and only makes it worse: the grip is the lowest of all, the speed limit is the
 * lowest of all (null = none). It reads the obstacle list and the earthquake area from the scene
 * (the fourth argument; the motorcycle stages give `ctx.input`), so the server and the predictor
 * on the phone, which run the same stages with the same scene, get the same ground.
 *
 * All sizes are TAHMİN, see constants.ts:
 * - puddle: with a lane, a rectangle of one lane wide (`graph.laneWidth`) and PUDDLE_LENGTH_M long
 *   in the middle of that lane; without a lane, the road itself (PUDDLE_ROAD_WIDTH_M) across.
 *   grip = min(base, params.gripPuddle): a puddle never gives more grip than the road.
 * - accident: a circle of ACCIDENT_SLOW_RADIUS_M around the centre of the accident (the same
 *   centre as its solid shape), for all lanes and both directions; speed limit
 *   ACCIDENT_SLOW_SPEED_MPS. The stages only apply the limit to the FORWARD speed.
 * - earthquake: inside the circle (x, y, radius) the grip is params.gripQuake. `strength` is not
 *   used (decision of LatifY, #80). No earthquake (null): no effect.
 * The border of every area belongs to the area (<=). The point is the centre of the motorcycle.
 *
 * `obstacles.<type>.effect` (0 to 1, owner M3, M1 registry) is NOT connected. The grip of a puddle
 * and of the earthquake already have their own parameters (physics.grip_puddle, quake.grip), so a
 * second strength would change them without saying so. To be asked of the owner of the parameter.
 *
 * Without a graph (`world.graph` null) the obstacles have no effect and nothing is thrown; the
 * earthquake does not need the graph. Without a scene (the old three argument call) only `base`.
 */
import { ACCIDENT_SLOW_RADIUS_M, ACCIDENT_SLOW_SPEED_MPS, PUDDLE_LENGTH_M, PUDDLE_ROAD_WIDTH_M } from './constants.js';
import { obstacleSites, type ObstacleSite } from './obstacles.js';
import { normalRoad, type PhysicsWorld, type SurfaceProvider } from '../world.js';

/** Is the point inside the rectangle (inclusive)? `length` is along the heading. */
function inRectangle(x: number, y: number, site: ObstacleSite, length: number, width: number): boolean {
  const dx = x - site.x;
  const dy = y - site.y;
  const cos = Math.cos(site.heading);
  const sin = Math.sin(site.heading);
  const along = cos * dx + sin * dy;
  const across = -sin * dx + cos * dy;
  // A hair of slack for the rounding of the rotation, so that a point exactly on the border is inside.
  const eps = 1e-9;
  return Math.abs(along) <= length / 2 + eps && Math.abs(across) <= width / 2 + eps;
}

export function colliderSurface(world: PhysicsWorld, base: SurfaceProvider = normalRoad): SurfaceProvider {
  return (x, y, params, scene) => {
    const ground = base(x, y, params, scene);
    if (!scene) return ground;
    let grip = ground.grip;
    let speedCap = ground.speedCap;

    const quake = scene.quake;
    if (quake && Math.hypot(x - quake.x, y - quake.y) <= quake.radius) grip = Math.min(grip, params.gripQuake);

    const graph = world.graph;
    if (graph) {
      for (const site of obstacleSites(scene.obstacles, graph)) {
        if (site.type === 'puddle') {
          const width = site.wholeRoad ? PUDDLE_ROAD_WIDTH_M : graph.laneWidth;
          if (inRectangle(x, y, site, PUDDLE_LENGTH_M, width)) grip = Math.min(grip, params.gripPuddle);
        } else if (site.type === 'accident') {
          if (Math.hypot(x - site.x, y - site.y) <= ACCIDENT_SLOW_RADIUS_M) {
            speedCap = speedCap === null ? ACCIDENT_SLOW_SPEED_MPS : Math.min(speedCap, ACCIDENT_SLOW_SPEED_MPS);
          }
        }
      }
    }
    return { grip, speedCap };
  };
}
