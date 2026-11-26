// Server emulator screen: npm run server -- [--port 47100] [--seed 1] [--hz 30]
//
// Takes the place of the server for the board (real board or board emulator).
// Keys:
//   v  vibrate all four motors        1-4  vibrate one motor (NW, NE, SW, SE)
//   + / -  delay on the board link    j  jitter    l  loss (both directions)
//   h  board states per second (10, 20, 30)        b  brightness
//   p  pause / resume    n  next phase    f  "Find me" for player 0
//   o  add an obstacle   e  earthquake from the server side
//   x  quit

import { ServerEmulator } from "./serverEmulator.js";
import { drawScreen, numArg, onKeys, parseArgs, screenEnd, screenStart, sparkline } from "../common/term.js";

const args = parseArgs(process.argv.slice(2));
const PHASES = ["lobby", "countdown", "game", "pause", "end"];
const LOSS = [0, 10, 30, 50];
const JITTER = [0, 20, 50];
const BRIGHT = [0.2, 0.6, 1];
const log: string[] = [];
const note = (s: string) => {
  log.push(`${new Date().toLocaleTimeString()}  ${s}`);
  if (log.length > 6) log.shift();
};

const emu = new ServerEmulator({
  port: numArg(args, "port", 47100),
  seed: numArg(args, "seed", 1),
  stateHz: numArg(args, "hz", 30),
  events: {
    link: (c) => note(c ? "board connected" : "board lost"),
    quake: (e) => note(`EARTHQUAKE from the board: ${e.src}, strength ${e.mag}, zone ${e.zone}, conf ${e.conf}, peak ${e.peak_g} g`),
  },
});

function screen(): void {
  const m = emu.metrics();
  const up = emu.net("up");
  const down = emu.net("down");
  const st = emu.lastStatus;
  const d = emu.scenario.boardState();
  const peak = Math.max(0, ...emu.seismic.slice(-80));
  drawScreen([
    `SERVER EMULATOR  port ${emu.port}   sid ${emu.link.sid}   board: ${m.connected ? "CONNECTED" : "waiting"}`,
    "",
    `delay ${m.delayMs ?? "-"} ms   real UDP loss from the board ${m.lossPct.toFixed(1)} %   states sent ${m.statesSent} at ${emu.currentStateHz}/s   resends ${m.resends}   bad messages ${m.badMessages}`,
    `added on the link: down ${down.delayMs} ms ±${down.jitterMs} loss ${down.lossPct}%   up ${up.delayMs} ms ±${up.jitterMs} loss ${up.lossPct}%`,
    "",
    `game: ${PHASES[d.ph as number]}  time left ${d.tl} s   players ${(d.p as unknown[]).length}   delivery points ${(d.dp as unknown[]).length}   obstacles ${(d.ob as unknown[]).length}   earthquake ${(d.eq as unknown[]).length ? "ON" : "off"}`,
    `config: bright ${Number(emu.currentConfig.bright).toFixed(2)}, max ${emu.currentConfig.max_ma} mA`,
    "",
    st
      ? `board status: fw ${st.fw}  plan ${st.plan}  fps ${st.fps}  rssi ${st.rssi} dBm  power ${st.ma_est} mA  heap ${st.heap}  last state ${st.last_seq}  errors ${JSON.stringify(st.err)}`
      : "board status: -",
    `seismic signal (g, last 0.8 s, peak ${peak.toFixed(2)}):`,
    `  ${sparkline(emu.seismic, Math.max(1, peak), 80)}`,
    "",
    "earthquake events and log:",
    ...log,
    "",
    "keys: v vibrate all  1-4 one motor  +/- delay  j jitter  l loss  h states/s  b bright  p pause  n next phase  f find me  o obstacle  e quake  x quit",
  ]);
}

async function quit(): Promise<void> {
  clearInterval(timer);
  await emu.close();
  screenEnd();
  process.exit(0);
}

screenStart();
await emu.start();
const timer = setInterval(screen, 100);
onKeys((k) => {
  const both = (patch: { delayMs?: number; jitterMs?: number; lossPct?: number }) => {
    emu.setNet("down", patch);
    emu.setNet("up", patch);
  };
  const mod = <T>(list: readonly T[], now: T) => list[(list.indexOf(now) + 1) % list.length];
  switch (k) {
    case "v":
      note(emu.vibrate(15) ? "vibrate: all motors, 0.8, 1500 ms" : "vibrate: no board");
      break;
    case "1":
    case "2":
    case "3":
    case "4":
      note(emu.vibrate(1 << (Number(k) - 1)) ? `vibrate: motor ${["NW", "NE", "SW", "SE"][Number(k) - 1]}` : "vibrate: no board");
      break;
    case "+":
      both({ delayMs: emu.net("down").delayMs + 50 });
      break;
    case "-":
      both({ delayMs: Math.max(0, emu.net("down").delayMs - 50) });
      break;
    case "j":
      both({ jitterMs: mod(JITTER, emu.net("down").jitterMs) });
      break;
    case "l":
      both({ lossPct: mod(LOSS, emu.net("down").lossPct) });
      break;
    case "h":
      emu.setStateHz(mod([10, 20, 30], emu.currentStateHz));
      break;
    case "b":
      emu.setConfig({ bright: mod(BRIGHT, emu.currentConfig.bright as number) });
      break;
    case "p":
      emu.scenario.togglePause();
      break;
    case "n":
      emu.scenario.nextPhase();
      break;
    case "f":
      emu.scenario.findMe(0);
      break;
    case "o":
      emu.scenario.addObstacle();
      break;
    case "e":
      emu.scenario.startQuake(Math.random(), Math.random(), 7);
      note("earthquake from the server side (no board event)");
      break;
    case "x":
    case "q":
      void quit();
  }
}, () => void quit());
