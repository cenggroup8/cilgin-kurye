// M1-5 demo: a short admin session with a fake match and fake obstacles.
// Run: npx tsx test/scenarios/admin-demo.ts

import { AdminHandler, type AdminCommand, type Phase, type Result } from "../../src/admin/admin.js";
import { PARAMS } from "../../src/admin/param-list.js";
import { ParamRegistry } from "../../src/admin/params.js";

const ok: Result = { ok: true };
let phase: Phase = "lobby";
const go = (to: Phase): Result => ((phase = to), ok);
const log = (who: string) => (...a: unknown[]) => (console.log(`    -> ${who}`, ...a), ok);

const params = new ParamRegistry(PARAMS);
const admin = new AdminHandler({
  params,
  match: {
    get phase() {
      return phase;
    },
    start: (bots) => (console.log(`    -> M1-2 start, ${bots} bots`), go("countdown")),
    pause: () => go("paused"),
    resume: () => go("playing"),
    end: () => go("ended"),
    reset: () => go("lobby"),
  },
  hazards: {
    addObstacle: (o) => log("M1-4 add obstacle")(o),
    removeObstacle: log("M1-4 remove obstacle"),
    closeRoad: log("M1-4 close road"),
    obstacleAhead: log("M1-4 obstacle ahead"),
    quake: log("M1-4 earthquake"),
  },
  network: { newGameCode: () => console.log("    -> M2 new game code") },
  sinks: {
    M2: (n, v) => console.log(`    -> M2 ${n} = ${v}`),
    M3: (n, v) => console.log(`    -> M3 ${n} = ${v}`),
    M4: (n, v) => console.log(`    -> M4 ${n} = ${v}`),
    M6: (n, v) => console.log(`    -> M6 ${n} = ${v}`),
  },
});

const list = admin.paramsMessage().list;
console.log(`params_get: ${list.length} parameters in ${new Set(list.map((p) => p.group)).size} groups`);

let id = 1;
const steps: [AdminCommand, Phase?][] = [
  [{ id: id++, name: "param_set", args: { name: "game.bots", value: 4 } }],
  [{ id: id++, name: "quake", args: { mag: 5, zone: 4 } }],
  [{ id: id++, name: "start" }],
  [{ id: id++, name: "param_set", args: { name: "physics.grip", value: 0.8 } }, "playing"],
  [{ id: id++, name: "param_set", args: { name: "physics.grip", value: 3 } }],
  [{ id: id++, name: "param_set", args: { name: "board.brightness", value: 0.3 } }],
  [{ id: id++, name: "obstacle_add", args: { type: "road_work", segment: 12, lane: 0, pos: 0.4 } }],
  [{ id: id++, name: "obstacle_add", args: { type: "lava", segment: 12, lane: 0, pos: 0.4 } }],
  [{ id: id++, name: "quake", args: { mag: 7, zone: -1 } }],
  [{ id: id++, name: "pause" }],
  [{ id: id++, name: "pause" }],
  [{ id: id++, name: "resume" }],
  [{ id: id++, name: "new_code" }],
  [{ id: id++, name: "end" }],
];

for (const [c, setPhase] of steps) {
  if (setPhase) phase = setPhase; // the countdown ends by itself in M1-2
  console.log(`[${phase}] ${c.name} ${c.args ? JSON.stringify(c.args) : ""}`);
  const out = admin.apply(c);
  console.log(`    reply: ${out.reply.ok ? "ok" : `error ${out.reply.error}`}`);
}
console.log(`physics.grip is ${params.get("physics.grip")} (the wrong value 3 was not saved)`);
