// Bir tick'in 8 adımı (M1-1, plan 3.1).
// Sıra sabittir. Kural parçaları birbirini çağırmaz; sadece bu dosya sırayı bilir.

import type { AdminCommand } from "../admin/admin.js";
import type { SeededRng } from "./rng.js";
import type {
  BoardEvent,
  MergedControl,
  PhysicsOutput,
  PhysicsRequest,
  TickInput,
  TrafficOutput,
  TrafficRequest,
} from "./types.js";
import type { WorldState } from "../state/world.js";
import { MATCH_DURATION_TICKS, COUNTDOWN_TICKS } from "../state/world.js";
import { mergeControls } from "./merge-controls.js";

// ── Paket arayüzleri (M1-2, M1-3, M1-4, M1-5 bağlanana kadar stub) ──

/** M1-5: admin komutları. */
export interface AdminStep {
  apply(cmds: readonly AdminCommand[], boardEvents: readonly BoardEvent[]): void;
}

/** M1-2: match and lobby. */
export interface MatchStep {
  update(world: WorldState, input: TickInput, rng: SeededRng): void;
}

/** M1-3 delivery and scoring. */
export interface DeliveryStep {
  update(world: WorldState, findMePlayers: Set<number>, rng: SeededRng): void;
}

/** M1-4: penalties, obstacles, earthquake. */
export interface HazardsStep {
  update(world: WorldState, input: TickInput, rng: SeededRng): void;
}

/** M3 proxy: traffic + physics. */
export interface M3Proxy {
  traffic(req: TrafficRequest): TrafficOutput;
  physics(req: PhysicsRequest): PhysicsOutput;
}

/** Callback after the state is frozen. */
export interface PostTickHook {
  afterTick(world: Readonly<WorldState>, input: TickInput): void;
}

// ── No-op stubs ────────────────────────────────────────────────────

export const noopAdmin: AdminStep = {
  apply() {},
};

export const noopMatch: MatchStep = {
  update() {},
};

export const noopDelivery: DeliveryStep = {
  update() {},
};

export const noopHazards: HazardsStep = {
  update() {},
};

// ── Tick deps ──────────────────────────────────────────────────────

export interface TickDeps {
  admin: AdminStep;
  match: MatchStep;
  delivery: DeliveryStep;
  hazards: HazardsStep;
  m3: M3Proxy;
  hooks: PostTickHook[];
}

// ── Tick ────────────────────────────────────────────────────────────

export function runTick(
  world: WorldState,
  input: TickInput,
  rng: SeededRng,
  deps: TickDeps,
): void {
  // Step 1: Take inputs (controls merged)
  const findMePlayers = mergeControls(world.controls, input.controls, input.findMe);

  // Step 2: Admin commands and board events
  deps.admin.apply(input.adminCommands, input.boardEvents);

  // Step 3: Update game phase
  deps.match.update(world, input, rng);

  // Only advance game logic when playing
  if (world.phase === "playing") {
    // Step 4: M3 traffic (NPC cars, bot controls, travel times)
    const trafficReq: TrafficRequest = {
      tick: world.tick,
      obstacles: world.obstacles,
      players: world.players,
    };
    const trafficOut = deps.m3.traffic(trafficReq);
    world.npcCars = trafficOut.npcCars;
    world.travelTimes = trafficOut.travelTimes;

    // Inject bot controls
    for (const bc of trafficOut.botControls) {
      const slot = world.controls[bc.player];
      if (slot && bc.seq > slot.seq) {
        slot.seq = bc.seq;
        slot.throttle = bc.throttle;
        slot.brake = bc.brake;
        slot.steer = bc.steer;
      }
    }

    // Step 5: M3 physics (poses, collisions, falls)
    const standUp: number[] = [];
    for (let i = 0; i < world.penaltyTicks.length; i++) {
      if (world.penaltyTicks[i]! === 1) standUp.push(i); // will reach 0 this tick
    }
    const physReq: PhysicsRequest = {
      controls: world.controls,
      obstacles: world.obstacles,
      quake: world.quake,
      standUp,
      falls: [], // M1-4 deprem düşmeleri buraya ekler
    };
    const physOut = deps.m3.physics(physReq);
    for (let i = 0; i < physOut.poses.length && i < world.poses.length; i++) {
      world.poses[i] = physOut.poses[i]!;
    }

    // Falls → world.lastFalls so HazardsStep (M1-4) can process them
    world.lastFalls = physOut.falls;

    // Step 6: Rules (delivery, penalties, obstacles)
    deps.delivery.update(world, findMePlayers, rng);
    deps.hazards.update(world, input, rng);

    // Advance game time
    world.gameTimeTicks++;
    if (world.gameTimeTicks >= MATCH_DURATION_TICKS) {
      world.phase = "ended";
    }
  } else if (world.phase === "countdown") {
    world.countdownTicks--;
    if (world.countdownTicks <= 0) {
      world.phase = "playing";
      world.gameTimeTicks = 0;
    }
  }

  // Step 7 & 8: hooks (state builder, recorder, metrics)
  world.tick++;
  for (const hook of deps.hooks) hook.afterTick(world, input);
}
