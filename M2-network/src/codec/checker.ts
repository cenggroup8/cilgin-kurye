import type { Role, Session } from "../session/types.js";
import { COMMAND_ARGS, checkFields, isMap, tableFor, type FieldSpec, type Reason } from "./schema.js";

/**
 * Checker (M2-2, v2.1 section 6.5 "Keeping the game state safe").
 *
 * Takes one decoded message and the session it came from. A message that passes is
 * rebuilt with only the fields of the contract, so nothing else from outside reaches M1.
 *
 * - type and fields: `schema.ts`
 * - every value in its range (for example steer between −1 and 1); out of range is refused
 * - a session controls only its own player
 * - a control with an old or repeated `seq` is dropped
 */

/** A message that passed the checks (plan #24 section 3.2, "Kontrol edilmiş mesaj"). */
export interface Checked {
  t: string;
  connId: number;
  role: Role;
  /** Players: the player number of the link (never the number in the message). */
  playerNo?: number;
  playerKey?: string;
  /** Only the fields of the contract. */
  fields: Record<string, unknown>;
  /** The network emulator may lose it (only state and control). */
  droppable: boolean;
}

export type CheckResult =
  | { ok: true; msg: Checked }
  /** Refused: the link gets an answer. `replyId`: a `cmd` whose `id` is usable gets a `reply`. */
  | { ok: false; reason: Reason | "unknown_command"; ref?: string; replyId?: number }
  /** Old or repeated order number: dropped without an answer. */
  | { ok: false; stale: true; ref: string };

export interface CheckerStats {
  passed: number;
  refused: number;
  stale: number;
  byReason: Record<string, number>;
}

export class Checker {
  readonly stats: CheckerStats = { passed: 0, refused: 0, stale: 0, byReason: {} };

  check(session: Session, raw: unknown): CheckResult {
    const r = this.inner(session, raw);
    if (r.ok) this.stats.passed++;
    else if ("stale" in r) this.stats.stale++;
    else {
      this.stats.refused++;
      this.stats.byReason[r.reason] = (this.stats.byReason[r.reason] ?? 0) + 1;
    }
    return r;
  }

  private inner(session: Session, raw: unknown): CheckResult {
    if (!isMap(raw) || typeof raw.t !== "string") return { ok: false, reason: "bad_message" };
    const t = raw.t;
    const spec = Object.prototype.hasOwnProperty.call(tableFor(session.role), t) ? tableFor(session.role)[t] : undefined;
    if (!spec) return { ok: false, reason: "unknown_type", ref: t };

    // A cmd with a usable id always gets a reply (contract, "Admin → server").
    const replyId = t === "cmd" && Number.isSafeInteger(raw.id) && (raw.id as number) >= 0 ? (raw.id as number) : undefined;

    const bad = checkFields(raw, spec.fields);
    if (bad) return { ok: false, reason: bad, ref: t, replyId };
    const fields = pick(raw, spec.fields);

    if (session.role === "player") {
      // hello and join are taken by M2-1 before the checker; here they are not allowed.
      if (t === "hello" || t === "join") return { ok: false, reason: "unexpected", ref: t };
      if (session.playerNo === undefined) return { ok: false, reason: "unexpected", ref: t };
      if (t === "control") {
        if (fields.player !== undefined && fields.player !== session.playerNo) {
          return { ok: false, reason: "not_your_player", ref: t };
        }
        const seq = fields.seq as number;
        if (seq <= session.lastSeq) return { ok: false, stale: true, ref: t };
        session.lastSeq = seq;
        fields.player = session.playerNo;
      }
    }

    if (t === "cmd") {
      const name = fields.name as string;
      const argSpec = Object.prototype.hasOwnProperty.call(COMMAND_ARGS, name) ? COMMAND_ARGS[name] : undefined;
      if (!argSpec) return { ok: false, reason: "unknown_command", ref: t, replyId };
      const args = (fields.args ?? {}) as Record<string, unknown>;
      const badArg = checkFields(args, argSpec);
      if (badArg) return { ok: false, reason: badArg, ref: t, replyId };
      fields.args = pick(args, argSpec);
    }

    return {
      ok: true,
      msg: {
        t,
        connId: session.connId,
        role: session.role,
        playerNo: session.playerNo,
        playerKey: session.playerKey,
        fields,
        droppable: spec.droppable,
      },
    };
  }
}

/** A new map with only the fields of the table (unknown fields and `__proto__` stay out). */
function pick(m: Record<string, unknown>, fields: Readonly<Record<string, FieldSpec>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(fields)) if (m[name] !== undefined) out[name] = m[name];
  return out;
}
