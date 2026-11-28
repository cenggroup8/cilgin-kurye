// M6-1, the link part of the board program (Umutcan): the real C++ code of
// M6-led-board/firmware/src/link on PC sockets (test/link/demo_board.cpp), against the
// fake server of the bench (fakes/boardServer.ts, written from contracts/ only). No M2.
//
// The board program runs for a fixed time and sends one hand hit at second 5.
// It prints one line per second; this adapter reads those lines (demo_board.cpp).
//
// Params:  state_hz (30), loss_pct (0: board states lost on the way), phase (2),
//          players (1–8) and speed_mps (8): the fake players that drive east
// Inputs:  vibrate (button), restart (button: server restart), loss_pct, state_hz, phase
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Adapter, Ctx } from "../../src/adapter.js";
import { REPO_DIR } from "../../src/modules.js";
import { FakeBoardServer, type World } from "../../fakes/boardServer.js";

export const LINK_DIR = join(REPO_DIR, "M6-led-board", "firmware", "test", "link");
const PHASES = ["lobby", "countdown", "game", "pause", "end"];

function run(cmd: string, args: string[], cwd: string, log: (s: string) => void): Promise<number> {
  return new Promise((ok) => {
    const p = spawn(cmd, args, { cwd });
    const read = (s: NodeJS.ReadableStream) => createInterface({ input: s }).on("line", log);
    read(p.stdout);
    read(p.stderr);
    p.on("error", (e) => {
      log(e.message);
      ok(-1);
    });
    p.on("exit", (code) => ok(code ?? -1));
  });
}

export function createLink(): Adapter {
  let ctx: Ctx;
  let server: FakeBoardServer | null = null;
  let board: ChildProcess | null = null;
  let boardEnded: Promise<void> = Promise.resolve();
  let tick: NodeJS.Timeout | null = null;
  let phase = 2;
  let players = 1;
  let speed = 8;
  let quake: { start: number; mag: number; u: number; v: number } | null = null;

  // For the checks.
  let vibratesSent = 0;
  let vibratesArrived = 0;
  let hitsSent = 0;
  let boardSawQuake = false;
  let restarts = 0;
  let restartAt = -1;
  let statesAfterRestart = 0; // board states taken after it connected again
  let changedAt = 0; // last change of state_hz, loss or a restart
  const rateSamples: number[] = []; // board states per second, after the last change
  const us: number[] = [];
  let final: { states: number; bad: number; late: number; connects: number } | null = null;
  let exitCode: number | null = null;
  let lastStatesSent = 0;
  let lastTickT = 0;

  const world = (s: number): World => {
    const q = quake && s - quake.start < 2 ? quake : null;
    if (!q) quake = null;
    return {
      ph: phase,
      tl: 240 - s,
      // Fake players (params players, speed_mps): each drives east on its own road, like make demo.
      players: Array.from({ length: players }, (_, i) => ({ no: i, team: i % 4, tone: (i >> 2) & 1, flags: 1 | 4 | 8, u: ((50 + 37 * i + speed * s) % 500) / 500, v: ((i % 5) + 1) / 6, heading: 90, speed })),
      dp: [[0, 0.8, 0.6667, 0]],
      ob: [[12, 2, 0]],
      eq: q ? [1, q.u, q.v, q.mag, Math.round((s - q.start) * 1000)] : [],
    };
  };

  const onBoardLine = (line: string) => {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\[board\s+(\d+)s\]\s+(\w+)\s+states\/s\s+(\d+)(.*)$/))) {
      const [, , state, rate, rest] = m;
      const n = Number(rate);
      ctx.emit({ kind: "metric", name: "board_states_per_s", value: n, unit: "1/s" });
      ctx.emit({ kind: "metric", name: "set_state_hz", value: server?.stateHz ?? 0, unit: "1/s" });
      if (state === "connected" && ctx.now() - changedAt > 2) rateSamples.push(n);
      if (restarts && state === "connected" && ctx.now() > restartAt) statesAfterRestart += n;
      const p = rest.match(/player (\d+) at u ([\d.]+) v ([\d.]+)/);
      if (p) {
        us.push(Number(p[2]));
        ctx.emit({ kind: "metric", name: "player_u", value: Number(p[2]) });
      }
      if (/EARTHQUAKE/.test(rest) && !boardSawQuake) {
        boardSawQuake = true;
        ctx.emit({ kind: "event", name: "board_shows_earthquake" });
      }
      ctx.emit({ kind: "log", text: line });
    } else if ((m = line.match(/\[board\] vibrate: zones mask (\d+), duty ([\d.]+), (\d+) ms/))) {
      vibratesArrived++;
      ctx.emit({ kind: "event", name: "vibrate_arrived", data: { mask: Number(m[1]), duty: Number(m[2]), ms: Number(m[3]) } });
    } else if (/\[board\] hand hit sent/.test(line)) {
      hitsSent++;
      ctx.emit({ kind: "event", name: "hit_sent", data: { zone: 4 } });
    } else if ((m = line.match(/^\[board\] states (\d+), bad messages (\d+), late dropped (\d+), connects (\d+)/))) {
      final = { states: Number(m[1]), bad: Number(m[2]), late: Number(m[3]), connects: Number(m[4]) };
      ctx.emit({ kind: "log", text: line });
    } else ctx.emit({ kind: "log", text: line });
  };

  const sample = () => {
    if (!server) return;
    const now = ctx.now();
    const sent = server.stats.statesSent;
    ctx.emit({ kind: "metric", name: "server_states_per_s", value: Math.round(((sent - lastStatesSent) / Math.max(0.001, now - lastTickT)) * 10) / 10, unit: "1/s" });
    lastStatesSent = sent;
    lastTickT = now;
    ctx.emit({ kind: "metric", name: "set_loss_pct", value: server.lossPct, unit: "%" });
  };

  const changed = () => {
    changedAt = ctx.now();
    rateSamples.length = 0;
  };

  return {
    async start(s, c) {
      ctx = c;
      phase = Number(s.params.phase ?? 2);
      players = Math.max(1, Math.min(8, Math.round(Number(s.params.players ?? 1))));
      speed = Number(s.params.speed_mps ?? 8);
      ctx.emit({ kind: "log", text: "building the board program (make build/demo_board) …" });
      const code = await run("make", ["build/demo_board"], LINK_DIR, (l) => ctx.emit({ kind: "log", text: `[make] ${l}` }));
      ctx.emit({ kind: "check", name: "board program builds", ok: code === 0, detail: code === 0 ? undefined : `make exit ${code}` });
      if (code !== 0) throw new Error("make build/demo_board failed (see the log)");

      server = new FakeBoardServer({
        stateHz: Number(s.params.state_hz ?? 30),
        lossPct: Number(s.params.loss_pct ?? 0),
        world,
        on: {
          link: (up) => ctx.emit({ kind: "event", name: up ? "board_connected" : "board_lost" }),
          quake: (q, again) => {
            if (again) return ctx.emit({ kind: "event", name: "quake_again", data: { id: q.id } });
            ctx.emit({ kind: "event", name: "quake_arrived", data: { zone: q.zone, mag: Math.round(q.mag * 10) / 10, src: q.src } });
            // What M1 would do (v2.1 section 5.5): an earthquake at the centre of the zone, motors on.
            const zc = (z: number) => [((z % 3) + 0.5) / 3, (Math.floor(z / 3) + 0.5) / 3];
            const [u, v] = zc(q.zone);
            quake = { start: ctx.now(), mag: q.mag, u, v };
            if (server?.vibrate({ mask: 15, duty: Math.min(1, q.mag / 10), ms: 2000, ramp_ms: 200 })) vibratesSent++;
          },
          status: (d) => {
            if (typeof d.fps === "number") ctx.emit({ kind: "metric", name: "board_fps", value: d.fps, unit: "fps" });
          },
          rtt: (ms) => ctx.emit({ kind: "metric", name: "rtt_ms", value: ms, unit: "ms" }),
          bad: (why) => ctx.emit({ kind: "log", text: `fake server: ${why}` }),
        },
      });
      const port = await server.start();
      const seconds = s.seconds === null ? 3600 : Math.max(1, Math.floor(s.seconds - 1));
      ctx.emit({ kind: "log", text: `fake server on port ${port}; board program runs ${seconds} s` });
      board = spawn(join(LINK_DIR, "build", "demo_board"), [String(port), String(seconds)], { cwd: LINK_DIR });
      createInterface({ input: board.stdout! }).on("line", onBoardLine);
      createInterface({ input: board.stderr! }).on("line", (l) => ctx.emit({ kind: "log", text: `[stderr] ${l}` }));
      boardEnded = new Promise((ok) => {
        board!.on("exit", (code) => {
          exitCode = code;
          ok();
          if (s.seconds !== null) ctx.done(); // the board program ran its time: the scenario is over
        });
      });
      tick = setInterval(sample, 500);
    },

    input(name, value) {
      if (!server) return;
      if (name === "vibrate") {
        if (server.vibrate({ mask: 15, duty: 0.6, ms: 800, ramp_ms: 100 })) {
          vibratesSent++;
          ctx.emit({ kind: "event", name: "vibrate_sent" });
        }
      } else if (name === "restart") {
        restarts++;
        restartAt = ctx.now();
        statesAfterRestart = 0;
        changed();
        server.restart();
        ctx.emit({ kind: "event", name: "server_restart", data: { sid: server.sid } });
      } else if (name === "loss_pct") {
        server.lossPct = Number(value);
        changed();
      } else if (name === "state_hz") {
        server.setStateHz(Number(value));
        changed();
      } else if (name === "phase") {
        phase = typeof value === "number" ? value : Math.max(0, PHASES.indexOf(String(value)));
      }
    },

    async stop() {
      if (tick) clearInterval(tick);
      if (board && board.exitCode === null) {
        board.kill("SIGTERM");
        await Promise.race([boardEnded, new Promise((ok) => setTimeout(ok, 1000))]);
      }
      if (!server) return;
      const st = server.stats;
      const hz = server.stateHz;
      const expected = hz * (1 - server.lossPct / 100);
      ctx.emit({ kind: "check", name: "board connects", ok: st.connects > 0 });
      if (rateSamples.length) {
        const med = [...rateSamples].sort((a, b) => a - b)[Math.floor(rateSamples.length / 2)];
        ctx.emit({ kind: "check", name: "board takes the states", ok: med >= expected * 0.8 && med <= hz + 2, detail: `median ${med}/s, expected about ${expected.toFixed(0)}/s` });
      }
      if (us.length >= 3) {
        const up = us.slice(1).filter((u, i) => u > us[i]).length;
        ctx.emit({ kind: "check", name: "motorcycle drives east (u grows)", ok: up >= (us.length - 1) * 0.8, detail: `u ${us[0].toFixed(3)} → ${us[us.length - 1].toFixed(3)}` });
      }
      if (hitsSent) {
        ctx.emit({ kind: "check", name: "earthquake event arrives once", ok: st.quakes === hitsSent, detail: `${hitsSent} hit, ${st.quakes} event, ${st.quakeRepeats} copies answered again` });
        ctx.emit({ kind: "check", name: "board shows the earthquake", ok: boardSawQuake });
      }
      if (vibratesSent) ctx.emit({ kind: "check", name: "vibrate arrives", ok: vibratesArrived === vibratesSent, detail: `${vibratesSent} sent, ${vibratesArrived} arrived` });
      if (restarts) ctx.emit({ kind: "check", name: "board finds the server again after a restart", ok: st.connects >= restarts + 1 && statesAfterRestart > 0, detail: `${restarts} restart, ${st.connects} connects, ${statesAfterRestart} states after it` });
      const f = final as { states: number; bad: number; late: number; connects: number } | null;
      ctx.emit({ kind: "check", name: "no bad messages", ok: st.bad === 0 && (!f || f.bad === 0), detail: `board ${f ? f.bad : "?"}, server ${st.bad}` });
      if (f) ctx.emit({ kind: "metric", name: "late_dropped", value: f.late });
      if (exitCode !== null) ctx.emit({ kind: "check", name: "board program ends connected", ok: exitCode === 0, detail: exitCode === 0 ? undefined : `exit ${exitCode}` });
      await server.close();
      server = null;
    },
  };
}
