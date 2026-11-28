import { decode, encode } from "@msgpack/msgpack";

/**
 * Message coding (M2-2, contracts/messages.md).
 *
 * On the wire every message is one MessagePack map. For development the server can also
 * take and send the same maps as JSON text (`readable`), so a message can be typed or read
 * by hand, for example in the browser console. The state for all phones stays MessagePack.
 */

export type Format = "msgpack" | "json";

export type Decoded = { ok: true; msg: unknown; format: Format } | { ok: false };

export interface CodecOptions {
  /** Also take JSON text frames, and answer such a link in JSON text. */
  readable?: boolean;
}

/** Deepest nesting that is decoded. A phone message is flat; this only stops a bomb. */
const MAX_DEPTH = 16;

export class Codec {
  readonly readable: boolean;

  constructor(opts: CodecOptions = {}) {
    this.readable = opts.readable ?? false;
  }

  /**
   * One WebSocket message to a value. `text` is true for a WebSocket text frame.
   * Never throws: a broken message gives `{ ok: false }`.
   */
  decode(data: Uint8Array, text = false): Decoded {
    if (text) {
      if (!this.readable) return { ok: false };
      try {
        const msg: unknown = JSON.parse(Buffer.from(data).toString("utf8"));
        return depth(msg) <= MAX_DEPTH ? { ok: true, msg, format: "json" } : { ok: false };
      } catch {
        return { ok: false };
      }
    }
    try {
      // The size limit (limits.ts) already runs before this; these only keep one value small.
      const msg = decode(data, { maxMapLength: 256, maxArrayLength: 1024, maxStrLength: 16 * 1024 });
      return depth(msg) <= MAX_DEPTH ? { ok: true, msg, format: "msgpack" } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  /** A value to bytes (MessagePack) or to text (JSON, readable form). */
  encode(msg: unknown, format: Format = "msgpack"): Uint8Array | string {
    return format === "json" ? JSON.stringify(msg) : encode(msg, { ignoreUndefined: true });
  }
}

function depth(v: unknown, d = 0): number {
  if (d > MAX_DEPTH || typeof v !== "object" || v === null) return d;
  let max = d;
  for (const x of Object.values(v)) max = Math.max(max, depth(x, d + 1));
  return max;
}

/** A short readable line of a message, for logs and the demo. */
export function describe(msg: unknown): string {
  try {
    const s = JSON.stringify(msg, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v));
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  } catch {
    return String(msg);
  }
}
