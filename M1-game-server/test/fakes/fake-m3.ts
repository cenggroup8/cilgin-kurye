// Sahte M3 (M1-1): sabit pozlar, senaryodaki düşme olayları, sabit süre tablosu.

import type { M3Proxy } from "../../src/loop/tick.js";
import type {
  FallEvent,
  PhysicsOutput,
  PhysicsRequest,
  Pose,
  TrafficOutput,
  TrafficRequest,
  ControlInput,
} from "../../src/loop/types.js";
import { defaultPose, MAX_PLAYERS, TEAMS } from "../../src/state/world.js";

export interface FakeM3Scenario {
  /** tick → fall events that M3 reports. */
  falls?: Record<number, FallEvent[]>;
  /** tick → poses override. Only listed players are overridden. */
  poseOverrides?: Record<number, Partial<Record<number, Partial<Pose>>>>;
  /** Fixed travel times: [store][point] → seconds. Default: 4×10 all 30s. */
  travelTimes?: number[][];
  /** Fixed bot controls per tick. */
  botControls?: Record<number, ControlInput[]>;
}

export function createFakeM3(scenario: FakeM3Scenario = {}): M3Proxy {
  const baseTravelTimes = scenario.travelTimes ??
    Array.from({ length: TEAMS }, () => Array.from({ length: 10 }, () => 30));

  return {
    traffic(req: TrafficRequest): TrafficOutput {
      const bots = scenario.botControls?.[req.tick] ?? [];
      return {
        npcCars: [],
        botControls: bots,
        travelTimes: baseTravelTimes,
        trafficMetrics: { npcCount: 0, meanNpcSpeed: 0, botRouteChanges: 0 },
      };
    },

    physics(req: PhysicsRequest): PhysicsOutput {
      // Find current tick from the controls' state — we just return defaults
      // We need the tick number but PhysicsRequest doesn't have it,
      // so we track it via closure.
      const poses: Pose[] = Array.from({ length: MAX_PLAYERS }, (_, i) => {
        const base = defaultPose();
        // Apply speed from controls
        const ctrl = req.controls[i];
        if (ctrl) base.speed = ctrl.throttle * 15; // simplified
        // Stand up if requested
        if (req.standUp.includes(i)) base.fallen = false;
        return base;
      });

      return { poses, collisions: [], falls: [] };
    },
  };
}

/** Wraps createFakeM3 to inject tick-dependent falls and pose overrides. */
export function createTickAwareFakeM3(scenario: FakeM3Scenario = {}): M3Proxy {
  let currentTick = 0;
  const base = createFakeM3(scenario);

  return {
    traffic(req: TrafficRequest): TrafficOutput {
      currentTick = req.tick;
      return base.traffic(req);
    },

    physics(req: PhysicsRequest): PhysicsOutput {
      const result = base.physics(req);

      // Override poses for this tick
      const overrides = scenario.poseOverrides?.[currentTick];
      if (overrides) {
        for (const [slot, partial] of Object.entries(overrides)) {
          const idx = Number(slot);
          if (result.poses[idx]) Object.assign(result.poses[idx], partial);
        }
      }

      // Add falls for this tick
      const falls = scenario.falls?.[currentTick];
      if (falls) {
        result.falls.push(...falls);
        for (const f of falls) {
          if (result.poses[f.player]) result.poses[f.player]!.fallen = true;
        }
      }

      return result;
    },
  };
}
