// M2-1 demo, without M1 and without real phones.
//   npm run demo        start the server; join from a real phone with the QR code
//   npm run demo:bots   bot phones show every "done" point of M2-1 and the demo ends
import { qrTerminal } from "./http/joinInfo.js";
import { startM2Server } from "./server.js";
import { RecordingM1, TestLink, waitFor } from "../test/helpers.js";

const bots = process.argv.includes("--bots");
const m1 = new RecordingM1();
m1.onEvent = (e) => console.log(`  M1 <- ${e.type}: player ${e.playerNo}` + ("team" in e ? `, team ${e.team}` : ""));

const server = await startM2Server({ port: Number(process.env.PORT ?? 8080), events: m1 });
console.log(`\nM2-1 server on port ${server.port}`);
console.log(`Game code: ${server.gameCode.value}`);
console.log(`Phone:     ${server.joinUrl()}`);
console.log(`Admin:     http://localhost:${server.port}/admin\n`);

if (!bots) {
  console.log(await qrTerminal(server.joinUrl()));
  console.log("Scan the QR code with a phone on the same Wi-Fi. Ctrl+C stops the server.\n");
} else {
  await runBots();
  await server.close();
  process.exit(0);
}

async function runBots(): Promise<void> {
  const code = server.gameCode.value;
  const ok = (text: string) => console.log(`✔ ${text}`);
  const open = (path?: string) => TestLink.open(server.port, path);

  console.log("1) A phone joins with the game code and picks a team");
  const a = await open();
  const w = await a.hello("bot-key-0", code, "bot 0");
  a.send({ t: "join", team: 0 });
  await waitFor(() => m1.events.find((e) => e.type === "join"));
  ok(`joined as player ${w.player}`);

  console.log("2) A wrong game code is rejected");
  const bad = await open();
  const r = await bad.hello("stranger", "000000");
  ok(`rejected: ${r.reason}`);

  console.log("3) The page reloads: same player key, same player number");
  a.close();
  await waitFor(() => m1.events.find((e) => e.type === "lost"));
  const a2 = await open();
  const w2 = await a2.hello("bot-key-0", code, "bot 0");
  await waitFor(() => m1.events.find((e) => e.type === "returned"));
  ok(`player ${w.player} before, player ${w2.player} after the reload`);

  console.log("4) Eight players fill the game, the 9th is rejected");
  for (let i = 1; i < 8; i++) await (await open()).hello(`bot-key-${i}`, code, `bot ${i}`);
  const ninth = await open();
  ok(`9th player: ${(await ninth.hello("bot-key-8", code)).reason}`);

  console.log("5) A second admin login drops the first one");
  const admin1 = await open("/ws/admin");
  await waitFor(() => server.registry.adminConn ?? undefined);
  await open("/ws/admin");
  ok(`first admin closed with code ${await admin1.closed()} (replaced)`);

  console.log("\nPlayers:", server.registry.players().map((p) => `${p.playerNo}${p.connected ? "" : " (lost)"}`).join(", "));
}
