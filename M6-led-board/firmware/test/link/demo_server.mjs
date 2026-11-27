// Demo, server side: the M2-4 board link (M2-network) with a tiny fake M1, and the board
// program of demo_board.cpp against it. Run: make demo   (DEMO_SECONDS=20 make demo)
//
//   fake M1 -> setWorldState (metres)  -> M2-4 -> S lists -> board: a motorcycle drives east
//   board hand hit -> Q -> M2-4 -> fake M1 -> earthquake in the state + vibrate -> board
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const m2 = resolve(here, "../../../../M2-network/src/board/boardLink.ts");
const { BoardLink } = await import(pathToFileURL(m2).href);

const PORT = Number(process.argv[2] ?? 47191);
const SECONDS = Number(process.env.DEMO_SECONDS ?? 10);
let quake = null;
let quakesFromBoard = 0;
const link = new BoardLink({
  port: PORT,
  host: "127.0.0.1",
  events: {
    quake: (e) => {
      // What M1 does with a hit (v2.1 section 5.5): an earthquake at the centre of the zone, motors on.
      quakesFromBoard++;
      console.log(`  [server] earthquake event from the board: strength ${e.mag.toFixed(1)}, zone ${e.zone} -> earthquake on, motors on`);
      quake = { x: 250, z: 250, mag: e.mag, start: Date.now() };
      link.vibrate({ mask: 15, duty: e.mag / 10, ms: 2000, ramp_ms: 200 });
    },
    link: (up) => console.log(`  [server] board ${up ? "connected" : "lost"}`),
  },
});
await link.start();
link.setConfig({ plan: "demo", bright: 0.5, max_ma: 8000, tones: Array.from({ length: 8 }, (_, i) => [40 * (i >> 1), 120, 255 - 40 * (i >> 1)]), anim: { tail: 2, dp_blink_hz: 1.5 } });

const t0 = Date.now();
const world = () => {
  const s = (Date.now() - t0) / 1000;
  if (quake && Date.now() - quake.start > 2000) quake = null;
  return {
    phase: "playing",
    timeLeft_s: 240 - s,
    // drives east along the road at z = 166.7 m, 8 m/s
    players: [{ no: 0, team: 1, tone: 0, x: (50 + 8 * s) % 500, z: 166.7, heading: 90, speed: 8, inGame: true, fallen: false, carrying: true, bot: true, findMe: false }],
    deliveries: [{ player: 0, x: 400, z: 333.3, delivered: false }],
    obstacles: [{ segment: 12, type: "road_work", lane: 0 }],
    quake: quake && { x: quake.x, z: quake.z, mag: quake.mag, ms: Date.now() - quake.start },
  };
};
link.setWorldState(world());
const tick = setInterval(() => link.setWorldState(world()), 1000 / 30); // M1 runs at 30 ticks per second

const board = spawn(resolve(here, "build/demo_board"), [String(PORT), String(SECONDS)], { stdio: "inherit" });
const boardOk = await new Promise((ok) => board.on("exit", (code) => ok(code === 0)));
clearInterval(tick);

const m = link.metrics();
console.log(`[server] states sent ${m.statesSent}, delay ${m.delayMs} ms, bad messages ${m.badMessages}, resends ${m.resends}, earthquake events ${quakesFromBoard}`);
await link.close();
const ok = boardOk && quakesFromBoard === 1 && m.badMessages === 0;
console.log(ok ? "\ndemo ok" : "\ndemo FAILED");
process.exit(ok ? 0 : 1);
