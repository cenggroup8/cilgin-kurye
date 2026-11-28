// M2-4 demo: the board link against the board emulator, with the network emulator in between.
//   npm run demo:board                      four steps of 5 s, then a short report
//   STEP_SECONDS=30 npm run demo:board      longer steps
//
// Steps: clean link → 80 ms added delay (±20 ms jitter) → 30 % loss both ways → clean again.
// In every step the board gets a vibrate command and sends one hand hit. What must arrive
// (TCP: vibrate, earthquake event) arrives once even with loss; only UDP states may be lost.
import { BoardLink, type QuakeEvent } from "./board/boardLink.js";
import { NetemSettings, type QueueSettings } from "./netem/netem.js";
import { BoardEmu } from "../test/fakes/boardEmu.js";

const stepS = Number(process.env.STEP_SECONDS ?? 5);
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const netem = new NetemSettings();
const quakes: QuakeEvent[] = [];
const link = new BoardLink({ port: 0, host: "127.0.0.1", netem, resendMs: 300, events: { quake: (e) => quakes.push(e) } });
const port = await link.start();
link.setConfig({ plan: "demo", bright: 0.5, max_ma: 8000, tones: Array.from({ length: 8 }, (_, i) => [40 * (i >> 1), 120, 255 - 40 * (i >> 1)]), anim: { tail: 2, dp_blink_hz: 1.5 } });
link.setWorldState({
  phase: "playing",
  timeLeft_s: 240,
  players: [{ no: 0, team: 0, tone: 0, x: 250, z: 250, heading: 90, speed: 8, inGame: true, fallen: false, carrying: false, bot: true, findMe: false }],
  deliveries: [],
  obstacles: [{ segment: 12, type: "road_work", lane: 0 }],
  quake: null,
});
const emu = new BoardEmu({ host: "127.0.0.1", port });
await emu.start();
while (!emu.connected) await wait(20);
console.log(`M2-4 demo on port ${port}: board link + board emulator, ${stepS} s per step\n`);

interface Step {
  name: string;
  both: Partial<QueueSettings>;
  check: (r: Result) => string | null;
}
interface Result {
  delayMs: number;
  downLossPct: number;
  vibrates: number;
  quakes: number;
}

const steps: Step[] = [
  { name: "clean link", both: { delayMs: 0, jitterMs: 0, lossPct: 0 }, check: (r) => (r.delayMs < 20 && r.downLossPct < 2 ? null : "delay under 20 ms, no loss") },
  { name: "80 ms delay, ±20 ms jitter (server → board)", both: { lossPct: 0 }, check: (r) => (r.delayMs > 55 && r.delayMs < 110 ? null : "measured delay near 80 ms") },
  { name: "30 % loss both ways", both: { delayMs: 0, jitterMs: 0, lossPct: 30 }, check: (r) => (r.downLossPct > 18 && r.downLossPct < 42 ? null : "state loss near 30 %") },
  { name: "clean again", both: { delayMs: 0, jitterMs: 0, lossPct: 0 }, check: (r) => (r.delayMs < 20 ? null : "delay back under 20 ms") },
];

const results: { step: Step; r: Result; fail: string | null }[] = [];
for (const [i, step] of steps.entries()) {
  netem.set("board", "up", step.both);
  netem.set("board", "down", step.both);
  if (i === 1) netem.set("board", "down", { delayMs: 80, jitterMs: 20 });
  console.log(`${i + 1}. ${step.name}`);
  await wait(1000); // let the queues settle

  const sent0 = link.metrics().statesSent;
  const got0 = emu.states.length;
  const vib0 = new Set(emu.vibrates.map((m) => m.seq)).size;
  const q0 = quakes.length;
  link.vibrate({ mask: 15, duty: 0.4, ms: 200, ramp_ms: 50 });
  emu.hit(5, 4);
  const delays: number[] = [];
  for (let s = 0; s < stepS; s++) {
    await wait(1000);
    const m = link.metrics();
    if (m.delayMs !== null) delays.push(m.delayMs);
    console.log(`   ${s + 1}s  delay ${m.delayMs ?? "-"} ms  states sent ${m.statesSent - sent0}  got ${emu.states.length - got0}  resends ${m.resends}`);
  }
  // Loss from the gaps in the order numbers of the states the board got in this step.
  const seqs = emu.states.slice(got0).map((m) => m.seq);
  const span = seqs.length ? Math.max(...seqs) - Math.min(...seqs) + 1 : 0;
  const r: Result = {
    delayMs: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : NaN,
    downLossPct: span ? (100 * (span - new Set(seqs).size)) / span : 100,
    vibrates: new Set(emu.vibrates.map((m) => m.seq)).size - vib0,
    quakes: quakes.length - q0,
  };
  let fail = step.check(r);
  if (!fail && (r.vibrates !== 1 || r.quakes !== 1)) fail = "vibrate and earthquake event arrive exactly once";
  results.push({ step, r, fail });
}

console.log("\nReport");
for (const { step, r, fail } of results) {
  console.log(
    `  ${fail ? "✘" : "✔"} ${step.name}: delay ${r.delayMs.toFixed(1)} ms, state loss ${r.downLossPct.toFixed(1)} %, ` +
      `vibrate ${r.vibrates}, earthquake event ${r.quakes}${fail ? `  (expected: ${fail})` : ""}`,
  );
}
const m = link.metrics();
console.log(`  link ${m.connected ? "connected" : "LOST"}, bad messages ${m.badMessages}, board → server loss since start ${m.lossPct.toFixed(1)} %`);

await emu.close();
await link.close();
process.exit(results.every((x) => !x.fail) && m.connected ? 0 : 1);
