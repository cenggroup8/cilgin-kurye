/**
 * The wallsAndObstacles stage of the collision solver (M3-2, step 2). Here it
 * handles buildings and the outer wall. Obstacles (barriers, accidents, puddles)
 * come in a later step.
 *
 * For every motorcycle that has not fallen, in the order of the player number:
 * find all contacts, handle the fastest hit first, push the motorcycle out and
 * take the speed into the shape away. A hit faster than `world.params.fallSpeed`
 * makes it fall.
 */
import type { SubstepContext } from '../step';
import type { BikeState, CollisionEvent, HitKind } from '../types';
import type { PhysicsWorld } from '../world';
import { BIKE_RADIUS_M, MAX_CONTACTS_PER_BIKE, MIN_IMPACT_MPS, OUTER_WALL_MARGIN_M } from './constants';
import { judgeImpact } from './fall-judge';
import { impactSpeedOf, resolveContact, type BikeMotion } from './resolve';
import { circleVsPolygon, type Circle, type Contact } from './shapes';

export interface Candidate {
  with: HitKind;
  /** Index of the building, or null for the outer wall (the event has `other: null`, see types.ts). */
  index: number | null;
  /** Finds the contact for a circle at its current place. */
  test: (c: Circle) => Contact | null;
}

/** The outer wall from the inside: the centre may go as far as the face minus the radius. */
function outerWallSides(world: PhysicsWorld): Candidate[] {
  const b = world.bounds;
  if (!b) return [];
  const minX = b.minX - OUTER_WALL_MARGIN_M;
  const maxX = b.maxX + OUTER_WALL_MARGIN_M;
  const minY = b.minY - OUTER_WALL_MARGIN_M;
  const maxY = b.maxY + OUTER_WALL_MARGIN_M;
  // Half planes, so nothing gets through, however far it is beyond the face. The normal points into the city.
  const side = (depthOf: (c: Circle) => number, nx: number, ny: number): Candidate => ({
    with: 'wall',
    index: null,
    test: (c) => {
      const depth = depthOf(c);
      return Number.isFinite(depth) && depth > 0 ? { depth, normalX: nx, normalY: ny } : null;
    },
  });
  return [
    side((c) => c.x + c.r - maxX, -1, 0),
    side((c) => minX - (c.x - c.r), 1, 0),
    side((c) => c.y + c.r - maxY, 0, -1),
    side((c) => minY - (c.y - c.r), 0, 1),
  ];
}

export function candidatesOf(world: PhysicsWorld): Candidate[] {
  const list: Candidate[] = world.buildings.map((polygon, index) => ({
    with: 'building' as const,
    index,
    test: (c: Circle) => circleVsPolygon(c, polygon),
  }));
  return list.concat(outerWallSides(world));
}

/** One collision event per player, kind of hit and other thing (`other`) in a tick: keep the largest impact. */
export function recordCollision(
  ctx: SubstepContext,
  player: number,
  hit: HitKind,
  other: number | null,
  impactSpeed: number,
): void {
  for (const e of ctx.events) {
    if (e.kind === 'collision' && e.player === player && e.with === hit && e.other === other) {
      e.impactSpeed = Math.max(e.impactSpeed, impactSpeed);
      return;
    }
  }
  const event: CollisionEvent = { kind: 'collision', player, with: hit, other, impactSpeed };
  ctx.events.push(event);
}

function motionOf(bike: BikeState): BikeMotion {
  return { x: bike.x, y: bike.y, heading: bike.heading, speed: bike.speed, slip: bike.slip };
}

/**
 * Resolves the contacts of one motorcycle. Every shape is looked at once, at
 * most MAX_CONTACTS_PER_BIKE are resolved, so the loop always ends. Gives back
 * how many contacts were resolved.
 */
export function solveBike(ctx: SubstepContext, bike: BikeState, candidates: Candidate[]): number {
  let resolved = 0;
  const circle = (): Circle => ({ x: bike.x, y: bike.y, r: BIKE_RADIUS_M });

  // Fastest hit first, then deepest, then the order of the list (so the result never depends on luck).
  const first = motionOf(bike);
  const hits: { c: Candidate; impact: number; depth: number; order: number }[] = [];
  candidates.forEach((c, order) => {
    const contact = c.test(circle());
    if (contact) hits.push({ c, impact: impactSpeedOf(first, contact), depth: contact.depth, order });
  });
  hits.sort((a, b) => b.impact - a.impact || b.depth - a.depth || a.order - b.order);

  for (const hit of hits) {
    if (resolved >= MAX_CONTACTS_PER_BIKE) break;
    // The earlier push may have cleared this contact, or changed it. Look again.
    const contact = hit.c.test(circle());
    if (!contact) continue;
    const motion = motionOf(bike);
    const impact = impactSpeedOf(motion, contact);
    resolved++;
    const out = resolveContact(motion, contact);
    bike.x = out.x;
    bike.y = out.y;
    bike.speed = out.speed;
    bike.slip = out.slip;

    if (impact <= MIN_IMPACT_MPS) continue;
    recordCollision(ctx, bike.id, hit.c.with, null, impact);
    if (judgeImpact(impact, ctx.world.params.fallSpeed) === 'fall') {
      bike.fallen = true;
      bike.speed = 0;
      bike.slip = 0;
      bike.sliding = false;
      ctx.events.push({ kind: 'fall', player: bike.id, cause: hit.c.with, impactSpeed: impact });
      return resolved; // a fallen motorcycle is not solid any more
    }
  }
  return resolved;
}

/** Buildings and the outer wall. */
export function wallsAndObstacles(ctx: SubstepContext): void {
  const candidates = candidatesOf(ctx.world);
  if (candidates.length === 0) return;
  const bikes = [...ctx.world.bikes.values()].sort((a, b) => a.id - b.id);
  for (const bike of bikes) {
    if (bike.fallen) continue;
    solveBike(ctx, bike, candidates);
  }
}
