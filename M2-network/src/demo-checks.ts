// M2-2 demo: the checker and the input queue with the fake M1 and 8 phone links (#35, plan #24 step 4).
//   npm run demo:checks                      10 s run, then a report
//   DEMO_SECONDS=60 npm run demo:checks      a longer run
//
// 6 bots play normally. Two more links send every kind of bad message: not MessagePack,
// no type, an unknown type, out of range values, a control for another player, a too big
// message, old order numbers, an admin command and a flood. At the end the demo checks that none of them reached M1,
// and that every "Find me" of the good bots did.
import { decode, encode } from "@msgpack/msgpack";
import WebSocket from "ws";
import { BotPhone, joinBots } from "../test/fakes/botPhone.js";
import { allTaken, startCheckedStack } from "../test/m2-2-stack.js";

const seconds = Number(process.env.DEMO_SECONDS ?? 10);
const stack = await startCheckedStack({ port: Number(process.env.PORT ?? 0) });
const { server, inbound } = stack;
const code = server.gameCode.value;

const good = await joinBots(server.port, code, 6);
const bad = await BotPhone.join(server.port, "bad-bot", code, { controlHz: 0 });
// The hand-made bad messages go on an eighth link, a plain socket with its own hello.
const raw = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
const rawErrors: string[] = [];
await new Promise<void>((ok) => raw.once("open", () => ok()));
raw.on("message", (d) => {
  const m = decode(d as Buffer) as { t?: string; reason?: string };
  if (m.t === "error") rawErrors.push(m.reason ?? "?");
});
raw.send(encode({ t: "hello", key: "raw-bot", name: "raw", code }));
await new Promise((ok) => setTimeout(ok, 100));
const rawNo = server.registry.players().find((p) => p.playerKey === "raw-bot")!.playerNo;
const otherNo = good[0]!.player;
// One good control first, so the "old order number" below is really old.
raw.send(encode({ t: "control", seq: 10_000, throttle: 1, brake: 0, steer: 0 }));

console.log(`M2-2 demo on port ${server.port}: fake M1 at 30 ticks per second, 6 good bots, 2 bad links, ${seconds} s`);
stack.run();

let findMeSent = 0;
const findMeTimer = setInterval(() => {
  for (const b of good) b.findMe();
  findMeSent += good.length;
}, 1000);

let badSeq = 1000;
const badTimer = setInterval(() => {
  for (const kind of ["not_msgpack", "no_type", "unknown_type", "bad_control"] as const) bad.sendBroken(kind);
  const c = (extra: Record<string, unknown>) => encode({ t: "control", seq: ++badSeq, throttle: 1, brake: 0, steer: 0, ...extra });
  raw.send(c({ player: otherNo, throttle: 1 })); // another player's motorcycle
  raw.send(c({ steer: 5 })); // out of range
  raw.send(c({ brake: -1 })); // out of range
  raw.send(encode({ t: "control", seq: ++badSeq, throttle: 1, brake: 0, steer: 0, pad: "x".repeat(2000) })); // too big
  raw.send(encode({ t: "control", seq: 1, throttle: 1, brake: 0, steer: 0 })); // old order number
  raw.send(encode({ t: "cmd", id: 1, name: "end" })); // admin command from a phone
}, 500);

// Once, a flood of 300 controls in one go from the raw link.
setTimeout(() => {
  for (let i = 0; i < 300; i++) raw.send(encode({ t: "control", seq: 1_000_000 + i, throttle: 1, brake: 0, steer: 0 }));
}, 2000);

await new Promise((ok) => setTimeout(ok, seconds * 1000));
clearInterval(findMeTimer);
clearInterval(badTimer);
await new Promise((ok) => setTimeout(ok, 300));
stack.m1.stop();
stack.tick();

const all = allTaken(stack.taken);
const badNo = bad.player;
const fromBad = all.controls.filter((c) => c.player === badNo).length;
const fromRaw = all.controls.filter((c) => c.player === rawNo);
const flood = fromRaw.filter((c) => c.seq >= 1_000_000);
// Only the first good control and controls of the flood are good; everything else was bad.
const rawOk = fromRaw.every((c) => c.seq === 10_000 || c.seq >= 1_000_000) && fromRaw.every((c) => c.steer >= -1 && c.steer <= 1 && c.brake >= 0 && c.brake <= 1);
const findMeGot = all.findMe.filter((f) => f.player !== badNo && f.player !== rawNo).length;
const stats = inbound.checker.stats;

console.log(`\n${stack.taken.length} ticks; M1 got ${all.controls.length} controls, ${all.findMe.length} "Find me", ${all.joins.length} joins`);
console.log(`Checker: ${stats.passed} passed, ${stats.refused} refused, ${stats.stale} old order numbers dropped`);
console.log(`  refused by reason: ${JSON.stringify(stats.byReason)}`);
console.log(`Limits: ${inbound.limiter.stats.tooBig} too big, ${inbound.limiter.stats.tooMany} over the rate`);
console.log(`Errors the bad bot got: ${new Set(bad.errors).size} kinds (${[...new Set(bad.errors)].join(", ")})`);
console.log(`Errors the raw link got: ${[...new Set(rawErrors)].join(", ")}`);
const checks: Array<[boolean, string]> = [
  [fromBad === 0, `no control of the bad bot reached M1 (${fromBad})`],
  [rawOk, `the raw link reached M1 only with its good controls (${fromRaw.length}, all in range, none of the bad ones)`],
  [flood.length > 0 && flood.length <= 60, `the flood was cut at the rate limit (${flood.length} of 300 reached M1)`],
  [all.adminCommands.length === 0, `no admin command came from a phone (${all.adminCommands.length})`],
  [findMeGot === findMeSent, `every "Find me" of the good bots reached M1 (${findMeGot}/${findMeSent})`],
  [good.every((b) => b.errors.length === 0), "the good bots got no error"],
];
for (const [ok, text] of checks) console.log(`  ${ok ? "✔" : "✘"} ${text}`);

good.forEach((b) => b.close());
bad.close();
raw.close();
await stack.close();
process.exit(checks.every(([ok]) => ok) ? 0 : 1);
