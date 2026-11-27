// M2-3 demo: fake M1, 8 bot phones and the state broadcaster, without real phones.
//   npm run demo:broadcast                      10 s run, then a short report
//   DEMO_SECONDS=600 npm run demo:broadcast     a long run of 10 minutes
//   PING_DELAY_MS=80 npm run demo:broadcast     bots answer pings 80 ms late
import { joinBots } from "../test/fakes/botPhone.js";
import { startStack } from "../test/fakes/stack.js";

const seconds = Number(process.env.DEMO_SECONDS ?? 10);
const pingDelayMs = Number(process.env.PING_DELAY_MS ?? 0);

const { m1, hub, server, close } = await startStack({ port: Number(process.env.PORT ?? 0) });
const bots = await joinBots(server.port, server.gameCode.value, 8, { pingDelayMs });
console.log(`M2-3 demo on port ${server.port}: fake M1 at 30 ticks per second, 8 bot phones, ${seconds} s`);
if (pingDelayMs > 0) console.log(`Bots answer pings ${pingDelayMs} ms late; the measured ping should be about that.`);

const first = m1.tick + 1;
const started = Date.now();
m1.run(hub);
const report = setInterval(() => {
  const s = hub.stats();
  const ping = hub.measures().map((m) => Math.round(m.rttMs)).join(" ");
  console.log(`  tick ${m1.tick}  state ${s.stateBytes} B  ${(s.bytesPerSecond / 1024).toFixed(1)} KiB/s  ping ms: ${ping}`);
}, 2000);

await new Promise((ok) => setTimeout(ok, seconds * 1000));
clearInterval(report);
m1.stop();
await new Promise((ok) => setTimeout(ok, 300));

const ticks = m1.tick - first + 1;
const elapsed = (Date.now() - started) / 1000;
const s = hub.stats();
console.log(`\n${ticks} ticks in ${elapsed.toFixed(1)} s (${(ticks / elapsed).toFixed(1)} per second)`);
console.log(`State size: ${s.stateBytes} B to phones, ${s.adminStateBytes} B to the admin; encoding takes ${s.encodeMs.toFixed(3)} ms`);
console.log(`Data to all phones: ${(s.bytesOut / elapsed / 1024).toFixed(1)} KiB/s on average`);
for (const b of bots) {
  const ok = b.states === ticks && b.missed === 0 && b.repeated === 0;
  console.log(`  ${ok ? "✔" : "✘"} player ${b.player}: ${b.states}/${ticks} states, missed ${b.missed}, controls sent ${b.controlsSent}`);
}
for (const m of hub.measures()) {
  console.log(`  player ${m.playerNo}: ping ${m.rttMs.toFixed(1)} ms, jitter ${m.jitterMs.toFixed(1)} ms, fps ${m.fps}, ${m.lagTicks} ticks behind`);
}
bots.forEach((b) => b.close());
await close();
process.exit(bots.every((b) => b.states === ticks && b.missed === 0) ? 0 : 1);
