// Checks every message from the server before the page uses it (M4-3).
// A broken or unknown message gives `undefined`; it never throws, so a bad message
// cannot break the page (done criterion of #45).

import { decode, encode } from "@msgpack/msgpack";
import type { PhoneMessage, ServerMessage } from "./types.ts";

function isMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}
function int(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** One server message, checked against `contracts/messages.md`. */
export function checkServerMessage(m: unknown): ServerMessage | undefined {
  if (!isMap(m) || typeof m.t !== "string") return undefined;
  switch (m.t) {
    case "welcome":
      return int(m.player, 0, 7) && typeof m.returning === "boolean" ? { t: "welcome", player: m.player, returning: m.returning } : undefined;
    case "joined":
      return int(m.player, 0, 7) && int(m.team, 0, 3) && typeof m.color === "string"
        ? { t: "joined", player: m.player, team: m.team, color: m.color } : undefined;
    case "error":
      if (typeof m.reason !== "string") return undefined;
      return typeof m.ref === "string" ? { t: "error", reason: m.reason, ref: m.ref } : { t: "error", reason: m.reason };
    case "state":
      return int(m.seq, 0) && isMap(m.s) ? { t: "state", seq: m.seq, s: m.s } : undefined;
    case "ping":
      return int(m.id, 1) && finite(m.st) ? { t: "ping", id: m.id, st: m.st } : undefined;
    case "net":
      return int(m.fps_limit, 0, 120) ? { t: "net", fps_limit: m.fps_limit } : undefined;
    default:
      return undefined;
  }
}

/** Bytes (or text in the readable form of the contract) to a checked message. */
export function decodeServerMessage(data: unknown): ServerMessage | undefined {
  try {
    if (typeof data === "string") return checkServerMessage(JSON.parse(data));
    if (data instanceof ArrayBuffer) return checkServerMessage(decode(new Uint8Array(data)));
    if (data instanceof Uint8Array) return checkServerMessage(decode(data));
  } catch {
    // A broken message is dropped; the page goes on.
  }
  return undefined;
}

export function encodePhoneMessage(m: PhoneMessage): Uint8Array {
  return encode(m);
}
