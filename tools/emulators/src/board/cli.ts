// Board emulator screen: npm run board -- [--host 127.0.0.1] [--port 47100] [--broadcast] [--leds 5]
//
// Shows the board as the LEDs would show the newest board state.
// Keys: 1-9 hit zone 1-9 (zone 0-8), m changes the strength, w turns the Wi-Fi
// off and on, x quits.

import { BoardEmulator } from "./boardEmulator.js";
import { renderBoard } from "./view.js";
import { drawScreen, numArg, onKeys, parseArgs, screenEnd, screenStart } from "../common/term.js";

const args = parseArgs(process.argv.slice(2));
const host = typeof args.host === "string" ? args.host : "127.0.0.1";
const port = numArg(args, "port", 47100);
const leds = numArg(args, "leds", 5);
const MAGS = [3, 6, 9];
let magIndex = 1;
let wifi = true;
const log: string[] = [];
const note = (s: string) => {
  log.push(`${new Date().toLocaleTimeString()}  ${s}`);
  if (log.length > 5) log.shift();
};

const board = new BoardEmulator({
  host,
  port,
  broadcast: args.broadcast === true,
  seed: numArg(args, "seed", Date.now() % 100000),
  events: {
    link: (s) => note(s === "connected" ? "connected to the server" : "link lost, searching"),
    config: (c) => note(`config: bright ${Number(c.bright).toFixed(2)}, max ${c.max_ma} mA, plan ${c.plan}`),
    vibrate: (v) => note(`vibrate: mask ${v.mask}, duty ${v.duty.toFixed(2)}, ${v.ms} ms, ramp ${v.ramp_ms} ms`),
    quakeSent: (e) => note(`earthquake event ${e.id} sent: ${e.src}, strength ${e.mag}, zone ${e.zone}`),
    quakeAnswered: (id) => note(`earthquake event ${id} answered by the server`),
  },
});

const PHASES = ["lobby", "countdown", "game", "pause", "end"];

function frame(): void {
  const st = board.latestState;
  const lines = renderBoard({ state: st?.d, config: board.config, link: board.linkState, nowMs: performance.now(), ledsPerSegment: leds });
  const s = board.stats;
  const ph = typeof st?.d.ph === "number" ? PHASES[st.d.ph] ?? "?" : "-";
  const motors = board
    .motorPower()
    .map((p, i) => `${["NW", "NE", "SW", "SE"][i]} ${"█".repeat(Math.round(p * 5)).padEnd(5, "·")}`)
    .join("  ");
  drawScreen([
    `BOARD EMULATOR  →  ${host}:${port}   Wi-Fi ${wifi ? "on" : "OFF"}   link: ${board.linkState.toUpperCase()}`,
    "",
    ...lines.map((l) => "  " + l),
    "",
    `phase ${ph}  time left ${st?.d.tl ?? "-"} s   state seq ${st?.seq ?? "-"}   states ${s.statesReceived} (late ${s.statesDropped})   bad ${s.badMessages}`,
    `motors  ${motors}`,
    `quake events sent ${s.quakesSent}, answered ${s.quakesAnswered}, resent ${s.resends}   configs ${s.configs}   vibrates ${s.vibrates}`,
    "",
    ...log,
    "",
    `keys: 1-9 hit zone (strength ${MAGS[magIndex]})   m strength   w Wi-Fi on/off   x quit`,
  ]);
}

async function quit(): Promise<void> {
  clearInterval(timer);
  await board.close();
  screenEnd();
  process.exit(0);
}

screenStart();
await board.start();
const timer = setInterval(frame, 100);
onKeys((k) => {
  if (k >= "1" && k <= "9") {
    const id = board.hit(Number(k) - 1, MAGS[magIndex]);
    if (id < 0) note(board.connected ? "hit taken into the motor event" : "hit, but no link: no event");
  } else if (k === "m") magIndex = (magIndex + 1) % MAGS.length;
  else if (k === "w") {
    wifi = !wifi;
    board.setWifi(wifi);
    note(wifi ? "Wi-Fi on" : "Wi-Fi off");
  } else if (k === "x" || k === "q") void quit();
}, () => void quit());
