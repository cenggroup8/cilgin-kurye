/// <reference types="node" />
// Board protocol codec (M2-4). Field meanings: contracts/board_protocol.md.
// MessagePack maps with string keys, floats as float32.
// decode() never throws: a bad message gives an error name, so a bad packet
// cannot stop the server.

import { decode as mpDecode, encode as mpEncode } from "@msgpack/msgpack";

export const PROTOCOL_VERSION = 1;

/** Message types (board_protocol.md section 3). */
export type MsgType = "S" | "C" | "V" | "P" | "O" | "H" | "Q" | "N" | "T" | "A";

export const SERVER_TO_BOARD: readonly MsgType[] = ["S", "C", "V", "P", "A"];
export const BOARD_TO_SERVER: readonly MsgType[] = ["O", "H", "Q", "N", "T", "A"];
const ALL_TYPES = new Set<string>([...SERVER_TO_BOARD, ...BOARD_TO_SERVER]);

/** Types that travel on UDP. Only these may be lost (board_protocol.md section 1). */
export const UDP_TYPES: ReadonlySet<MsgType> = new Set(["S", "P", "O", "N", "H"]);

export interface BoardMsg {
  t: MsgType;
  v: number;
  /** Session number; only on messages from the server. */
  sid?: number;
  seq: number;
  ts: number;
  ack?: true;
  d: Record<string, unknown>;
}

export type DecodeResult = { ok: true; msg: BoardMsg } | { ok: false; error: DecodeError };
export type DecodeError = "not_msgpack" | "not_a_map" | "bad_type" | "bad_version" | "bad_field";

const isUint = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
const isMap = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x) && !(x instanceof Uint8Array);

/** Writes the frame fields in the order of the vectors, so the bytes match them. */
export function encode(msg: BoardMsg): Uint8Array {
  const out: Record<string, unknown> = { t: msg.t, v: msg.v };
  if (msg.sid !== undefined) out.sid = msg.sid;
  out.seq = msg.seq;
  out.ts = msg.ts;
  if (msg.ack) out.ack = true;
  out.d = msg.d;
  return mpEncode(out, { forceFloat32: true });
}

export function decode(bytes: Uint8Array): DecodeResult {
  let raw: unknown;
  try {
    raw = mpDecode(bytes);
  } catch {
    return { ok: false, error: "not_msgpack" };
  }
  if (!isMap(raw)) return { ok: false, error: "not_a_map" };
  if (typeof raw.t !== "string" || !ALL_TYPES.has(raw.t)) return { ok: false, error: "bad_type" };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, error: "bad_version" };
  if (!isUint(raw.seq) || !isUint(raw.ts) || !isMap(raw.d)) return { ok: false, error: "bad_field" };
  if (raw.sid !== undefined && !isUint(raw.sid)) return { ok: false, error: "bad_field" };
  if (raw.ack !== undefined && raw.ack !== true) return { ok: false, error: "bad_field" };
  return { ok: true, msg: raw as unknown as BoardMsg };
}

// --- TCP framing -----------------------------------------------------------
// Each TCP message starts with its length: 2 bytes, unsigned, high byte first
// (board_protocol.md section 2).

export const MAX_FRAME = 0xffff;

export function frame(body: Uint8Array): Buffer {
  if (body.length > MAX_FRAME) throw new Error(`message too long: ${body.length} bytes`);
  const out = Buffer.allocUnsafe(2 + body.length);
  out.writeUInt16BE(body.length, 0);
  out.set(body, 2);
  return out;
}

/** Cuts a TCP byte stream into messages. Chunks may hold half a message or many. */
export class Deframer {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const out: Buffer[] = [];
    while (this.buf.length >= 2) {
      const len = this.buf.readUInt16BE(0);
      if (this.buf.length < 2 + len) break;
      out.push(this.buf.subarray(2, 2 + len));
      this.buf = this.buf.subarray(2 + len);
    }
    return out;
  }

  /** Bytes that wait for the rest of their message. */
  get pending(): number {
    return this.buf.length;
  }
}
