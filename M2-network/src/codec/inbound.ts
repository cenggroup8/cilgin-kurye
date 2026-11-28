import type { Session } from "../session/types.js";
import type { InputQueue } from "../queue/inputQueue.js";
import { Checker, type Checked } from "./checker.js";
import { Limiter } from "./limits.js";

/**
 * The incoming line of M2 (plan #24 section 3.2):
 *
 *   link → session → limits → codec and checker → input queue → M1
 *
 * `admit` runs on the raw bytes before decoding (M2-1 `wsServer` calls it for every
 * message, also the hello). `onMessage` takes every decoded message after the hello.
 * A good message goes to the queue (control, "Find me", admin command), to M2-3
 * (pong, snapshot_get) or to `onRequest` (params_get, log_get). A bad one gets an answer
 * and goes nowhere.
 */
export interface InboundOptions {
  queue: InputQueue;
  /** Sends one message to a link (M2-1 `server.send`). */
  send(connId: number, msg: unknown): void;
  /**
   * Checked messages of the other M2 parts, rebuilt with only the contract fields:
   * `pong` and `snapshot_get` for M2-3 (`hub.onMessage`).
   */
  others?(session: Session, msg: Record<string, unknown>): void;
  /** Checked admin requests that are not tick inputs: `params_get`, `log_get`. */
  onRequest?(session: Session, msg: Checked): void;
  now?: () => number;
}

export interface Inbound {
  admit(session: Session, bytes: number): boolean;
  onMessage(session: Session, msg: unknown): void;
  readonly checker: Checker;
  readonly limiter: Limiter;
}

const TO_OTHERS = new Set(["pong", "snapshot_get"]);

export function createInbound(opts: InboundOptions): Inbound {
  const checker = new Checker();
  const limiter = new Limiter(opts.now);

  return {
    checker,
    limiter,

    admit(session, bytes) {
      const r = limiter.admit(session.connId, session.role, bytes);
      if (r.ok) return true;
      if (r.tell) opts.send(session.connId, { t: "error", reason: r.reason });
      return false;
    },

    onMessage(session, raw) {
      const r = checker.check(session, raw);
      if (!r.ok) {
        if ("stale" in r) return;
        if (r.replyId !== undefined) {
          opts.send(session.connId, { t: "reply", id: r.replyId, ok: false, error: r.reason });
        } else {
          opts.send(session.connId, r.ref === undefined ? { t: "error", reason: r.reason } : { t: "error", reason: r.reason, ref: r.ref });
        }
        return;
      }
      const msg = r.msg;
      if (opts.queue.push(msg)) return;
      if (TO_OTHERS.has(msg.t)) {
        opts.others?.(session, { t: msg.t, ...msg.fields });
        return;
      }
      opts.onRequest?.(session, msg);
    },
  };
}
