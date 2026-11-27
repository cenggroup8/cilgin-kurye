/**
 * The carsAndBikes stage of the collision solver (M3-2, step 3): a motorcycle
 * against NPC cars, and a motorcycle against another motorcycle.
 *
 * NPC car: a turned rectangle (x, y = centre, length along the heading). M3-2
 * does not move the car (the traffic part owns its pose): the motorcycle is
 * pushed out completely and goes on with the speed of the car along the normal.
 * The hit speed is the closing speed along the contact normal. A hit above the
 * fall speed makes the motorcycle fall. Every hit of at least CAR_HIT_MIN_MPS on
 * a car that is not off the road goes to the traffic part as a CarHit, once per
 * car and tick, with the largest speed.
 *
 * Two motorcycles: equal circles, equal mass. Each moves half of the depth and
 * loses half of the closing speed (the hit is not elastic). If the closing speed
 * along the normal is above the fall speed, BOTH fall.
 *
 * A fallen motorcycle is not solid. Order: motorcycles by player number, cars by
 * id, pairs (i, j) with i < j, so the result never depends on the order of the
 * lists that M1 gives.
 */
import type { CarHit, NpcCarPose } from '../../traffic/npc/types.js';
import type { SubstepContext } from '../step.js';
import type { BikeState } from '../types.js';
import { BIKE_RADIUS_M, CAR_HIT_MIN_MPS, MAX_CONTACTS_PER_BIKE, MIN_IMPACT_MPS } from './constants.js';
import { judgeImpact, relativeNormalSpeed } from './fall-judge.js';
import { resolveContactMoving, velocityOf, type BikeMotion } from './resolve.js';
import { recordCollision } from './stages.js';
import { circleVsCircle, circleVsOBB, type Circle, type Obb } from './shapes.js';

function motionOf(bike: BikeState): BikeMotion {
  return { x: bike.x, y: bike.y, heading: bike.heading, speed: bike.speed, slip: bike.slip };
}

function apply(bike: BikeState, m: BikeMotion): void {
  bike.x = m.x;
  bike.y = m.y;
  bike.speed = m.speed;
  bike.slip = m.slip;
}

function circleOf(bike: BikeState): Circle {
  return { x: bike.x, y: bike.y, r: BIKE_RADIUS_M };
}

function boxOf(car: NpcCarPose): Obb {
  return { x: car.x, y: car.y, length: car.length, width: car.width, heading: car.heading };
}

function carVelocity(car: NpcCarPose): { vx: number; vy: number } {
  const s = Number.isFinite(car.speed) ? car.speed : 0;
  return { vx: s * Math.cos(car.heading), vy: s * Math.sin(car.heading) };
}

/** A motorcycle that falls: it stops where it is (the push out has been done). */
function knockDown(ctx: SubstepContext, bike: BikeState, cause: 'npc' | 'bike', impactSpeed: number): void {
  bike.fallen = true;
  bike.speed = 0;
  bike.slip = 0;
  bike.sliding = false;
  ctx.events.push({ kind: 'fall', player: bike.id, cause, impactSpeed });
}

/** One CarHit per car and tick: keep the largest speed (the list is shared by both substeps). */
function recordCarHit(carHits: CarHit[], carId: number, impactSpeed: number): void {
  for (const h of carHits) {
    if (h.carId === carId) {
      h.impactSpeed = Math.max(h.impactSpeed, impactSpeed);
      return;
    }
  }
  carHits.push({ carId, impactSpeed });
}

function solveAgainstCars(ctx: SubstepContext, bike: BikeState, cars: NpcCarPose[]): void {
  const first = velocityOf(motionOf(bike));
  // Fastest hit first, then deepest, then the car with the smaller id.
  const hits: { index: number; speed: number; depth: number }[] = [];
  cars.forEach((car, index) => {
    const c = circleVsOBB(circleOf(bike), boxOf(car));
    if (c) hits.push({ index, speed: relativeNormalSpeed(first, carVelocity(car), { x: c.normalX, y: c.normalY }), depth: c.depth });
  });
  hits.sort((a, b) => b.speed - a.speed || b.depth - a.depth || a.index - b.index);

  let resolved = 0;
  for (const hit of hits) {
    if (resolved >= MAX_CONTACTS_PER_BIKE) break;
    const car = cars[hit.index];
    const c = circleVsOBB(circleOf(bike), boxOf(car)); // the earlier push may have changed it
    if (!c) continue;
    const motion = motionOf(bike);
    const other = carVelocity(car);
    const speed = relativeNormalSpeed(velocityOf(motion), other, { x: c.normalX, y: c.normalY });
    resolved++;
    apply(bike, resolveContactMoving(motion, c, other, 1, 1));

    if (speed >= CAR_HIT_MIN_MPS && car.state !== 'offroad') recordCarHit(ctx.carHits, car.id, speed);
    if (speed <= MIN_IMPACT_MPS) continue;
    recordCollision(ctx, bike.id, 'npc', car.id, speed);
    if (judgeImpact(speed, ctx.world.params.fallSpeed) === 'fall') {
      knockDown(ctx, bike, 'npc', speed);
      return; // a fallen motorcycle is not solid any more
    }
  }
}

function solvePair(ctx: SubstepContext, a: BikeState, b: BikeState): void {
  const c = circleVsCircle(circleOf(a), circleOf(b)); // the normal points from b to a
  if (!c) return;
  const va = velocityOf(motionOf(a));
  const vb = velocityOf(motionOf(b));
  const n = { x: c.normalX, y: c.normalY };
  const speed = relativeNormalSpeed(va, vb, n);
  // Both from the speeds before the hit, so the order of the two does not matter.
  apply(a, resolveContactMoving(motionOf(a), c, vb, 0.5, 0.5));
  apply(b, resolveContactMoving(motionOf(b), { depth: c.depth, normalX: -c.normalX, normalY: -c.normalY }, va, 0.5, 0.5));

  if (speed <= MIN_IMPACT_MPS) return;
  recordCollision(ctx, a.id, 'bike', b.id, speed);
  recordCollision(ctx, b.id, 'bike', a.id, speed);
  if (judgeImpact(speed, ctx.world.params.fallSpeed) === 'fall') {
    knockDown(ctx, a, 'bike', speed);
    knockDown(ctx, b, 'bike', speed);
  }
}

/** NPC cars and other motorcycles. */
export function carsAndBikes(ctx: SubstepContext): void {
  const bikes = [...ctx.world.bikes.values()].sort((x, y) => x.id - y.id);
  const cars = [...ctx.input.npcCars].sort((x, y) => x.id - y.id);

  if (cars.length > 0) {
    for (const bike of bikes) if (!bike.fallen) solveAgainstCars(ctx, bike, cars);
  }
  for (let i = 0; i < bikes.length; i++) {
    for (let j = i + 1; j < bikes.length; j++) {
      if (bikes[i].fallen || bikes[j].fallen) continue;
      solvePair(ctx, bikes[i], bikes[j]);
    }
  }
}
