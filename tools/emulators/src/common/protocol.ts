// Board protocol for the emulators (contracts/board_protocol.md).
//
// The bytes come from the M2-4 codec (M2-network/src/board/codec.ts), the same
// code that the real server uses, so the emulators can never speak a different
// protocol than the server. Run `npm install` in M2-network once.

export {
  BOARD_TO_SERVER,
  Deframer,
  MAX_FRAME,
  PROTOCOL_VERSION,
  SERVER_TO_BOARD,
  UDP_TYPES,
  decode,
  encode,
  frame,
  type BoardMsg,
  type DecodeResult,
  type MsgType,
} from "../../../../M2-network/src/board/codec.js";

import { PROTOCOL_VERSION, type BoardMsg, type MsgType } from "../../../../M2-network/src/board/codec.js";

/** Default TCP and UDP port of the board link (the M2-4 default). */
export const DEFAULT_PORT = 47100;

/**
 * Makes messages with the right frame fields. Each message type is counted by
 * itself (board_protocol.md section 5); `A` and `O` copy the seq they answer.
 */
export class MessageFactory {
  private readonly seqOut = new Map<MsgType, number>();
  private readonly t0: number;

  constructor(
    /** Session number for messages from the server; undefined on the board. */
    private readonly sid?: number,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.t0 = clock();
  }

  /** Milliseconds since this side started (board_protocol.md, `ts`). */
  now(): number {
    return Math.floor(this.clock() - this.t0);
  }

  make(t: MsgType, d: Record<string, unknown>, ack = false): BoardMsg {
    const seq = (this.seqOut.get(t) ?? 0) + 1;
    this.seqOut.set(t, seq);
    return this.raw(t, seq, d, ack);
  }

  /** A message with a given seq: answers (`A`, `O`). */
  raw(t: MsgType, seq: number, d: Record<string, unknown>, ack = false, ts = this.now()): BoardMsg {
    const msg: BoardMsg = { t, v: PROTOCOL_VERSION, seq, ts, d };
    if (this.sid !== undefined) msg.sid = this.sid;
    if (ack) msg.ack = true;
    return msg;
  }

  /** Board restart: all order numbers start again. */
  resetSeq(): void {
    this.seqOut.clear();
  }
}
