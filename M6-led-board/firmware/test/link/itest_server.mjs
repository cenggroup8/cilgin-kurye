// Integration test, server side: starts the M2-4 board link (M2-network) and
// runs the board program from itest_board.cpp against it.
// Run: make itest   (needs M2-network with M2-4 and its npm packages)
//
//   0 s  server starts, the board connects, sends a hit, sensor samples and status
//   3 s  vibrate command
//   5 s  server restart: the link closes and a new one opens on the same port with a
//        new session number and a new state (tl 199); the board must find it by itself
//  11 s  the board program ends and checks what it got
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const m2 = resolve(here, "../../../../M2-network/src/board/boardLink.ts");
const { BoardLink } = await import(pathToFileURL(m2).href);

const PORT = Number(process.argv[2] ?? 47190);
const CONFIG = {
  plan: "0.2.0",
  bright: 0.6,
  max_ma: 4000,
  tones: Array.from({ length: 8 }, (_, i) => [10 * i, 20, 30]),
  anim: { tail: 2, dp_blink_hz: 1.5 },
};
const STATE = { ph: 2, tl: 200, p: [[2, 1, 0, 13, 0.4248, 0.1962, 88, 11.2]], dp: [[2, 0.7, 0.304, 0]], ob: [[12, 2, 0]], eq: [] };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function startServer(sid, state) {
  const seen = { quakes: [], sensors: 0, statuses: 0 };
  const link = new BoardLink({
    port: PORT,
    host: "127.0.0.1",
    sid,
    events: {
      quake: (e) => seen.quakes.push(e),
      sensor: () => seen.sensors++,
      status: () => seen.statuses++,
    },
  });
  await link.start();
  link.setConfig(CONFIG);
  link.setState(state);
  return { link, seen };
}

const first = await startServer(1001, STATE);
const board = spawn(resolve(here, "build/itest_board"), [String(PORT)], { stdio: "inherit" });
const boardDone = new Promise((ok) => board.on("exit", (code) => ok(code === 0)));

await wait(3000);
first.link.vibrate({ mask: 15, duty: 0.8, ms: 1500, ramp_ms: 200 });
await wait(2000);
const m1 = first.link.metrics();
await first.link.close();
const second = await startServer(2002, { ...STATE, tl: 199 });
console.log("server restarted with a new session number");

const boardOk = await boardDone;
const m2s = second.link.metrics();
await second.link.close();

let failed = boardOk ? 0 : 1;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const q = first.seen.quakes;
console.log("server side, before the restart:");
check(q.length === 1 && q[0].mag > 6.49 && q[0].mag < 6.51 && q[0].zone === 4, "one earthquake event from the board");
check(first.seen.sensors > 30, "sensor samples arrive");
check(first.seen.statuses >= 3, "status reports arrive");
check(m1.delayMs !== null && m1.delayMs < 50, `delay measured (${m1.delayMs} ms)`);
check(m1.badMessages === 0, "no bad message");
check(m1.resends === 0, "every config and vibrate answered at once (d.of)");
console.log("server side, after the restart:");
check(m2s.statesSent > 30 && second.seen.statuses >= 2, `the board came back by itself (${second.seen.statuses} status reports)`);
check(second.seen.quakes.length === 0, "the old earthquake event is not sent again to the new server");
check(m2s.badMessages === 0, "no bad message");
console.log(failed ? "\nintegration FAILED" : "\nintegration ok");
process.exit(failed ? 1 : 0);
