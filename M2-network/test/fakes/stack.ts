// The M2 server with M2-3 and the fake M1, for the M2-3 tests and demo.
import { attachBroadcast, type BroadcastHub } from "../../src/broadcast/broadcastHub.js";
import { startM2Server, type M2Server } from "../../src/server.js";
import { FakeM1 } from "./fakeM1.js";

export interface Stack {
  m1: FakeM1;
  hub: BroadcastHub;
  server: M2Server;
  close(): Promise<void>;
}

/** A few parameters in the shape of M1-5's list, for the admin snapshot. */
export const FAKE_PARAMS = [
  { name: "board.state_hz", group: "board", label: "Board states per second", value: 30, min: 10, max: 30, integer: true, owner: "M2" },
  { name: "net.0.up.delay_ms", group: "net", label: "Player 0 up: added delay (ms)", value: 0, min: 0, max: 2000, integer: true, owner: "M2" },
];

export async function startStack(opts: { port?: number; pingMs?: number } = {}): Promise<Stack> {
  const m1 = new FakeM1();
  let hub: BroadcastHub | undefined;
  const server = await startM2Server({
    port: opts.port ?? 0,
    publicHost: "127.0.0.1",
    events: m1,
    // M2-3 takes its own messages; the rest goes to M1 (M2-2's checker and queue come later).
    onMessage: (session, msg) => {
      if (!hub?.onMessage(session, msg)) m1.input(session, msg);
    },
  });
  hub = attachBroadcast({ server, toM1: (m) => m1.net(m), pingMs: opts.pingMs });
  hub.params(FAKE_PARAMS);
  const h = hub;
  return {
    m1,
    hub: h,
    server,
    async close() {
      m1.stop();
      h.close();
      await server.close();
    },
  };
}
