// M2 adapter (Umutcan): the M2-4 board link alone, against the fake board of M2
// (M2-network/test/fakes/boardEmu.ts), with the network emulator in between.
// No M1, no real board: the world state is a fixed fake state.
//
// Params (scenario file):  delay_ms, jitter_ms              server → board
//                          loss_pct                        both directions
//                          expect_delay_ms: [min, max]     check of the measured delay at the end
//                          expect_loss_pct: [min, max]     check of the state loss at the end
// Inputs: the same three as sliders, "vibrate" (button), "hit" (button, value = zone 0–8).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, AdapterModule, Ctx } from "../../src/adapter.js";
import { REPO_DIR } from "../../src/modules.js";
import { BoardLink, type QuakeEvent } from "../../../../M2-network/src/board/boardLink.js";
import { NetemSettings } from "../../../../M2-network/src/netem/netem.js";
import { BoardEmu } from "../../../../M2-network/test/fakes/boardEmu.js";

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const SETTLE_S = 1; // after a change, the queues need about 1 s before we measure

type Range = [number, number];
const range = (x: unknown): Range | null =>
  Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number") ? (x as Range) : null;

function create(): Adapter {
  let link: BoardLink | null = null;
  let emu: BoardEmu | null = null;
  let ctx: Ctx;
  let tick: NodeJS.Timeout | null = null;
  const netem = new NetemSettings();
  const set = { delay_ms: 0, jitter_ms: 0, loss_pct: 0 };
  let expectDelay: Range | null = null;
  let expectLoss: Range | null = null;

  // Counters for the checks.
  let vibratesSent = 0;
  let hitsSent = 0;
  const quakeIds: number[] = [];
  let changedAt = 0; // last change of the link settings
  const delays: number[] = []; // measured after the last change + SETTLE_S
  const seqs: number[] = []; // order numbers of the states the board got, same window

  // State of the last tick.
  let lastStates = 0;
  let lastT = 0;
  let lastVib = 0;

  const apply = () => {
    // Like demo-board.ts: delay and jitter on server → board (that is what the board feels),
    // loss on both directions.
    netem.set("board", "down", { delayMs: set.delay_ms, jitterMs: set.jitter_ms, lossPct: set.loss_pct });
    netem.set("board", "up", { delayMs: 0, jitterMs: 0, lossPct: set.loss_pct });
    changedAt = ctx.now();
    delays.length = 0;
    seqs.length = 0;
    ctx.emit({ kind: "metric", name: "set_delay_ms", value: set.delay_ms, unit: "ms" });
    ctx.emit({ kind: "metric", name: "set_loss_pct", value: set.loss_pct, unit: "%" });
  };

  const sample = () => {
    if (!link || !emu) return;
    const now = ctx.now();
    const m = link.metrics();
    const settled = now - changedAt >= SETTLE_S;

    const fresh = emu.states.slice(lastStates);
    lastStates = emu.states.length;
    const rate = fresh.length / Math.max(0.001, now - lastT);
    lastT = now;
    const freshSeqs = fresh.map((s) => s.seq as number);
    if (settled) seqs.push(...freshSeqs);

    ctx.emit({ kind: "metric", name: "set_delay_ms", value: set.delay_ms, unit: "ms" });
    if (m.delayMs !== null) {
      ctx.emit({ kind: "metric", name: "delay_ms", value: m.delayMs, unit: "ms" });
      if (settled) delays.push(m.delayMs);
    }
    ctx.emit({ kind: "metric", name: "states_per_s", value: Math.round(rate * 10) / 10, unit: "1/s" });
    ctx.emit({ kind: "metric", name: "set_loss_pct", value: set.loss_pct, unit: "%" });
    ctx.emit({ kind: "metric", name: "state_loss_pct", value: lossPct(freshSeqs), unit: "%" });
    ctx.emit({ kind: "metric", name: "resends", value: m.resends });

    const vib = new Set(emu.vibrates.map((v) => v.seq)).size;
    for (let i = lastVib; i < vib; i++) ctx.emit({ kind: "event", name: "vibrate_arrived" });
    lastVib = vib;
  };

  return {
    async start(s, c) {
      ctx = c;
      set.delay_ms = Number(s.params.delay_ms ?? 0);
      set.jitter_ms = Number(s.params.jitter_ms ?? 0);
      set.loss_pct = Number(s.params.loss_pct ?? 0);
      expectDelay = range(s.params.expect_delay_ms);
      expectLoss = range(s.params.expect_loss_pct);

      link = new BoardLink({
        port: 0,
        host: "127.0.0.1",
        netem,
        resendMs: 300,
        events: {
          quake: (e: QuakeEvent) => {
            quakeIds.push(e.id);
            ctx.emit({ kind: "event", name: "quake_arrived", data: { zone: e.zone, mag: e.mag, src: e.src } });
          },
          link: (up: boolean) => ctx.emit({ kind: "event", name: up ? "board_connected" : "board_lost" }),
        },
      });
      const port = await link.start();
      // A fixed fake world (what M1 would send): one bot in the middle, one road work.
      link.setConfig({ plan: "demo", bright: 0.5, max_ma: 2000, tones: Array.from({ length: 8 }, (_, i) => [40 * (i >> 1), 120, 255 - 40 * (i >> 1)]), anim: { tail: 2, dp_blink_hz: 1.5 } });
      link.setWorldState({
        phase: "playing",
        timeLeft_s: 240,
        players: [{ no: 0, team: 0, tone: 0, x: 250, z: 250, heading: 90, speed: 8, inGame: true, fallen: false, carrying: false, bot: true, findMe: false }],
        deliveries: [],
        obstacles: [{ segment: 12, type: "road_work", lane: 0 }],
        quake: null,
      });
      emu = new BoardEmu({ host: "127.0.0.1", port });
      await emu.start();
      for (let i = 0; i < 150 && !emu.connected; i++) await wait(20);
      ctx.emit({ kind: "log", text: `M2-4 board link on port ${port}, fake board ${emu.connected ? "connected" : "NOT connected"}` });
      ctx.emit({ kind: "check", name: "fake board connects", ok: emu.connected });
      apply();
      lastT = ctx.now();
      tick = setInterval(sample, 250);
    },

    input(name, value) {
      if (!link || !emu) return;
      if (name === "delay_ms" || name === "jitter_ms" || name === "loss_pct") {
        set[name] = Number(value);
        apply();
      } else if (name === "vibrate") {
        if (link.vibrate({ mask: 15, duty: 0.4, ms: 200, ramp_ms: 50 })) {
          vibratesSent++;
          ctx.emit({ kind: "event", name: "vibrate_sent" });
        }
      } else if (name === "hit") {
        const zone = Math.max(0, Math.min(8, Math.round(Number(value ?? 4))));
        emu.hit(5, zone);
        hitsSent++;
        ctx.emit({ kind: "event", name: "hit_sent", data: { zone } });
      }
    },

    async stop() {
      if (tick) clearInterval(tick);
      if (!link || !emu) return;
      // Give what is on the way (resends) a moment to arrive.
      await wait(Math.min(1200, 400 + 2 * set.delay_ms));
      sample();
      const m = link.metrics();
      const vibArrived = new Set(emu.vibrates.map((v) => v.seq)).size;
      const quakes = new Set(quakeIds).size;
      ctx.emit({ kind: "check", name: "link stays connected", ok: m.connected });
      if (vibratesSent) {
        ctx.emit({ kind: "check", name: "vibrate arrives once", ok: vibArrived === vibratesSent, detail: `${vibratesSent} sent, ${vibArrived} arrived` });
      }
      if (hitsSent) {
        ctx.emit({ kind: "check", name: "earthquake event arrives once", ok: quakes === hitsSent && quakeIds.length === quakes, detail: `${hitsSent} hits, ${quakes} events, ${quakeIds.length - quakes} doubles` });
      }
      if (expectDelay) {
        const avg = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : NaN;
        ctx.emit({ kind: "check", name: `measured delay ${expectDelay[0]}–${expectDelay[1]} ms`, ok: avg >= expectDelay[0] && avg <= expectDelay[1], detail: `${avg.toFixed(1)} ms` });
      }
      if (expectLoss) {
        const loss = lossPct(seqs);
        ctx.emit({ kind: "check", name: `state loss ${expectLoss[0]}–${expectLoss[1]} %`, ok: loss >= expectLoss[0] && loss <= expectLoss[1], detail: `${loss.toFixed(1)} %` });
      }
      await emu.close();
      await link.close();
      link = null;
      emu = null;
    },
  };
}

/** Loss from the gaps in the order numbers of the states the board got (like demo-board.ts). */
function lossPct(seqs: number[]): number {
  if (seqs.length < 2) return 0;
  const span = Math.max(...seqs) - Math.min(...seqs) + 1;
  return Math.round((1000 * (span - new Set(seqs).size)) / span) / 10;
}

export function ready(): string | null {
  return existsSync(join(REPO_DIR, "M2-network", "node_modules")) ? null : "run npm ci in M2-network first";
}

export default { create, ready } satisfies AdapterModule;
export { create };
