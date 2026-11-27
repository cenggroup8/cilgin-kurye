// Kontrollerin birleştirilmesi (M1-1, plan 3.3).
// Bir tick'te aynı oyuncudan birden çok kontrol gelirse en yenisi (en büyük seq)
// kullanılır. Hiç gelmezse önceki tick'in kontrolü korunur.
// "Find me" olay tabanlı: tick içinde herhangi bir mesajda varsa sayılır.

import type { ControlInput, FindMeInput, MergedControl } from "./types.js";

/**
 * Merges incoming controls into the existing control array (mutates `current`).
 * Returns the set of players who sent a "Find me" this tick.
 */
export function mergeControls(
  current: MergedControl[],
  incoming: readonly ControlInput[],
  findMe: readonly FindMeInput[],
): Set<number> {
  // For each player, pick the control with the highest seq
  for (const c of incoming) {
    const slot = current[c.player];
    if (slot && c.seq > slot.seq) {
      slot.seq = c.seq;
      slot.throttle = c.throttle;
      slot.brake = c.brake;
      slot.steer = c.steer;
    }
  }

  const findMePlayers = new Set<number>();
  for (const f of findMe) findMePlayers.add(f.player);
  return findMePlayers;
}
