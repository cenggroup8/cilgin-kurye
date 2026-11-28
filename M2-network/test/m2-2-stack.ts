// The M2 server with the M2-2 checks and queue in front of M2-3 and the fake M1.
// Used by the M2-2 tests and `npm run demo:checks`.
import { attachBroadcast, type BroadcastHub } from "../src/broadcast/broadcastHub.js";
import { createInbound, type Inbound } from "../src/codec/inbound.js";
import { InputQueue } from "../src/queue/inputQueue.js";
import type { TickInput } from "../src/queue/types.js";
import { startM2Server, type M2Server } from "../src/server.js";
import { FakeM1 } from "./fakes/fakeM1.js";
import { FAKE_PARAMS } from "./fakes/stack.js";

export interface CheckedStack {
  server: M2Server;
  queue: InputQueue;
  inbound: Inbound;
  hub: BroadcastHub;
  m1: FakeM1;
  /** Every tick input that M1 took, in order. */
  taken: TickInput[];
  /** One tick of M1: take the queue, then publish the state. */
  tick(): TickInput;
  /** Runs the fake M1 at 30 ticks per second; every tick takes the queue first. */
  run(): void;
  close(): Promise<void>;
}

export async function startCheckedStack(opts: { port?: number; readable?: boolean; pingMs?: number } = {}): Promise<CheckedStack> {
  const queue = new InputQueue();
  const m1 = new FakeM1();
  const taken: TickInput[] = [];
  const log: Array<{ time: number; message: string }> = [];
  let server: M2Server | undefined;
  let hub: BroadcastHub | undefined;

  const inbound = createInbound({
    queue,
    send: (connId, msg) => server?.send(connId, msg),
    others: (session, msg) => hub?.onMessage(session, msg),
    onRequest: (session, msg) => {
      // In the real server M1-5 answers params_get (`AdminHandler.paramsMessage`) and the
      // recorder of M1-1 the log. Here the fake values of M2-3 are enough.
      if (msg.t === "params_get") server?.send(session.connId, { t: "params", list: FAKE_PARAMS });
      if (msg.t === "log_get") {
        const since = (msg.fields.since as number | undefined) ?? -Infinity;
        server?.send(session.connId, { t: "log", entries: log.filter((e) => e.time > since) });
      }
    },
  });

  server = await startM2Server({
    port: opts.port ?? 0,
    publicHost: "127.0.0.1",
    events: queue,
    onMessage: inbound.onMessage,
    admit: inbound.admit,
    readable: opts.readable,
  });
  hub = attachBroadcast({ server, toM1: (m) => m1.net(m), pingMs: opts.pingMs });
  hub.params(FAKE_PARAMS);
  const h = hub;
  const s = server;

  function takeInputs(): TickInput {
    const input = queue.take();
    taken.push(input);
    for (const c of input.adminCommands) log.push({ time: Date.now(), message: `cmd ${c.name}` });
    return input;
  }

  return {
    server: s,
    queue,
    inbound,
    hub: h,
    m1,
    taken,
    tick() {
      const input = takeInputs();
      h.publish(m1.frame());
      return input;
    },
    run() {
      m1.run({
        publish: (f) => {
          takeInputs();
          h.publish(f);
        },
        metrics: (samples) => h.metrics(samples),
      });
    },
    async close() {
      m1.stop();
      h.close();
      await s.close();
    },
  };
}

/** All tick inputs that M1 took, in one list per kind. */
export function allTaken(taken: readonly TickInput[]): TickInput {
  const out: TickInput = { controls: [], findMe: [], joins: [], disconnects: [], reconnects: [], adminCommands: [], boardEvents: [] };
  for (const t of taken) {
    for (const k of Object.keys(out) as Array<keyof TickInput>) (out[k] as unknown[]).push(...t[k]);
  }
  return out;
}
