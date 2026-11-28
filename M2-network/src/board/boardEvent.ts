// Earthquake event of the board in the shape of the M2-2 input queue (M2-4).
//
// The board link gives the event as the protocol has it (board_protocol.md, `Q`):
// `{ src: "hit" | "motor", mag, zone, conf, ... }`. The input queue of M2-2 (#91)
// and M1-1 take `{ source: "hand" | "motors", magnitude, zone, confidence }`.
// Wiring: `new BoardLink({ events: { quake: (e) => queue.boardEvent(toBoardEvent(e)) } })`.

import type { QuakeEvent } from "./boardLink.js";

/** Same shape as `BoardEvent` in `src/queue/types.ts` (M2-2) and M1-1. */
export interface QueueBoardEvent {
  source: "hand" | "motors";
  magnitude: number; // 0–10
  zone: number; // 0–8
  confidence: number; // 0–1
}

export function toBoardEvent(e: QuakeEvent): QueueBoardEvent {
  return {
    source: e.src === "hit" ? "hand" : "motors",
    magnitude: e.mag,
    zone: e.zone,
    confidence: e.conf,
  };
}
