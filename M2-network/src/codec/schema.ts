/**
 * Message tables of the phone and admin links (M2-2, contracts/messages.md).
 *
 * Every message is a map with a type `t`. This file lists, for each link, which types may
 * come in and which fields each type has. The checker (`checker.ts`) reads only these
 * tables, so a new message is added here and in contracts/messages.md, nowhere else.
 */
import type { Role } from "../session/types.js";

/** Why a message was refused. Same words as the "Error reasons" table of the contract. */
export type Reason =
  | "bad_message"
  | "unknown_type"
  | "bad_field"
  | "out_of_range"
  | "not_your_player"
  | "too_big"
  | "too_many"
  | "unexpected";

export type FieldSpec =
  | { kind: "number"; min?: number; max?: number; optional?: boolean }
  | { kind: "int"; min?: number; max?: number; optional?: boolean }
  | { kind: "string"; minLen?: number; maxLen?: number; pattern?: RegExp; optional?: boolean }
  | { kind: "oneOf"; values: readonly string[]; optional?: boolean }
  | { kind: "map"; optional?: boolean };

export interface MessageSpec {
  fields: Readonly<Record<string, FieldSpec>>;
  /** May the network emulator lose it (v2.1 section 6.5: only state and control). */
  droppable: boolean;
}

const INT_MAX = Number.MAX_SAFE_INTEGER;

/** Messages a phone may send after its hello. `hello` and `join` are taken by M2-1 first. */
export const PHONE_IN: Readonly<Record<string, MessageSpec>> = {
  hello: {
    droppable: false,
    fields: {
      key: { kind: "string", minLen: 1, maxLen: 64 },
      // Longer names are cut to 24 by M2-1, not refused.
      name: { kind: "string" },
      code: { kind: "string", pattern: /^\d{6}$/ },
    },
  },
  join: { droppable: false, fields: { team: { kind: "int", min: 0, max: 3 } } },
  control: {
    droppable: true,
    fields: {
      seq: { kind: "int", min: 1, max: INT_MAX },
      throttle: { kind: "number", min: 0, max: 1 },
      brake: { kind: "number", min: 0, max: 1 },
      steer: { kind: "number", min: -1, max: 1 },
      player: { kind: "int", min: 0, max: 7, optional: true },
    },
  },
  find_me: { droppable: false, fields: {} },
  pong: {
    droppable: false,
    fields: {
      id: { kind: "int", min: 1, max: INT_MAX },
      ct: { kind: "number" },
      fps: { kind: "number", min: 0, max: 1000 },
      last: { kind: "int", min: -1, max: INT_MAX },
    },
  },
};

/** Messages the admin page may send. */
export const ADMIN_IN: Readonly<Record<string, MessageSpec>> = {
  snapshot_get: { droppable: false, fields: {} },
  params_get: { droppable: false, fields: {} },
  log_get: { droppable: false, fields: { since: { kind: "number", optional: true } } },
  cmd: {
    droppable: false,
    fields: {
      id: { kind: "int", min: 0, max: INT_MAX },
      name: { kind: "string", minLen: 1, maxLen: 32 },
      args: { kind: "map", optional: true },
    },
  },
};

const OBSTACLE_TYPES = ["heavy_traffic", "road_work", "accident", "puddle"] as const;
const SEGMENT: FieldSpec = { kind: "int", min: 0, max: 59 };

/**
 * Arguments of each admin command (contract table "Commands"). M2 checks the shape and the
 * ranges; M1-5 checks again and decides about the phase and the parameter names.
 */
export const COMMAND_ARGS: Readonly<Record<string, Readonly<Record<string, FieldSpec>>>> = {
  start: {},
  pause: {},
  resume: {},
  end: {},
  reset: {},
  new_code: {},
  param_reset: {},
  param_set: { name: { kind: "string", minLen: 1, maxLen: 64 }, value: { kind: "number" } },
  obstacle_add: {
    type: { kind: "oneOf", values: OBSTACLE_TYPES },
    segment: SEGMENT,
    lane: { kind: "int", min: 0, max: 4 },
    pos: { kind: "number", min: 0, max: 1 },
  },
  obstacle_remove: { id: { kind: "int", min: 0, max: INT_MAX } },
  road_close: { segment: SEGMENT },
  obstacle_ahead: { player: { kind: "int", min: 0, max: 7 }, type: { kind: "oneOf", values: OBSTACLE_TYPES } },
  quake: { mag: { kind: "number", min: 0, max: 10 }, zone: { kind: "int", min: -1, max: 8 } },
};

export function tableFor(role: Role): Readonly<Record<string, MessageSpec>> {
  return role === "admin" ? ADMIN_IN : PHONE_IN;
}

/** Messages that the network emulator may lose, in both directions (contract "Which messages may be lost"). */
export function isDroppable(t: string): boolean {
  return t === "state" || t === "control";
}

/**
 * Checks the fields of one map against a field table.
 * Returns null when every field is right, otherwise the reason. Unknown fields are ignored.
 */
export function checkFields(m: Record<string, unknown>, fields: Readonly<Record<string, FieldSpec>>): Reason | null {
  for (const [name, spec] of Object.entries(fields)) {
    const v = m[name];
    if (v === undefined) {
      if (spec.optional) continue;
      return "bad_field";
    }
    const r = checkValue(v, spec);
    if (r) return r;
  }
  return null;
}

function checkValue(v: unknown, spec: FieldSpec): Reason | null {
  switch (spec.kind) {
    case "number":
    case "int":
      if (typeof v !== "number" || !Number.isFinite(v)) return "bad_field";
      if (spec.kind === "int" && !Number.isInteger(v)) return "bad_field";
      if (spec.min !== undefined && v < spec.min) return "out_of_range";
      if (spec.max !== undefined && v > spec.max) return "out_of_range";
      return null;
    case "string":
      if (typeof v !== "string") return "bad_field";
      if (spec.minLen !== undefined && v.length < spec.minLen) return "out_of_range";
      if (spec.maxLen !== undefined && v.length > spec.maxLen) return "out_of_range";
      if (spec.pattern && !spec.pattern.test(v)) return "out_of_range";
      return null;
    case "oneOf":
      if (typeof v !== "string") return "bad_field";
      return spec.values.includes(v) ? null : "out_of_range";
    case "map":
      return isMap(v) ? null : "bad_field";
  }
}

export function isMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}
