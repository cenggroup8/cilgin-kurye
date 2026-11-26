// Integration test, server side: starts the M2-4 board link (M2-network) and
// runs the board program from itest_board.cpp against it.
// Run: make itest   (needs M2-network with M2-4 and its npm packages)
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const m2 = resolve(here, "../../../../M2-network/src/board/boardLink.ts");
const { BoardLink } = await import(pathToFileURL(m2).href);

const PORT = Number(process.argv[2] ?? 47190);
const quakes = [];
let sensors = 0;
let statuses = 0;
const link = new BoardLink({
  port: PORT,
  host: "127.0.0.1",
  events: {
    quake: (e) => quakes.push(e),
    sensor: () => sensors++,
    status: () => statuses++,
  },
});
await link.start();
link.setConfig({
  plan: "0.2.0",
  bright: 0.6,
  max_ma: 4000,
  tones: Array.from({ length: 8 }, (_, i) => [10 * i, 20, 30]),
  anim: { tail: 2, dp_blink_hz: 1.5 },
});
link.setState({ ph: 2, tl: 200, p: [[2, 1, 0, 13, 0.4248, 0.1962, 88, 11.2]], dp: [[2, 0.7, 0.304, 0]], ob: [[12, 2, 0]], eq: [] });

const board = spawn(resolve(here, "build/itest_board"), [String(PORT)], { stdio: "inherit" });
setTimeout(() => link.vibrate({ mask: 15, duty: 0.8, ms: 1500, ramp_ms: 200 }), 3000);
const boardOk = await new Promise((ok) => board.on("exit", (code) => ok(code === 0)));

const m = link.metrics();
let failed = boardOk ? 0 : 1;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
console.log("server side:");
check(quakes.length === 1 && quakes[0].mag > 6.49 && quakes[0].mag < 6.51 && quakes[0].zone === 4, "one earthquake event from the board");
check(sensors > 30, "sensor samples arrive");
check(statuses >= 3, "status reports arrive");
check(m.delayMs !== null && m.delayMs < 50, `delay measured (${m.delayMs} ms)`);
check(m.badMessages === 0, "no bad message");
check(m.resends === 0, "every config and vibrate answered at once (d.of)");
await link.close();
console.log(failed ? "\nintegration FAILED" : "\nintegration ok");
process.exit(failed ? 1 : 0);
