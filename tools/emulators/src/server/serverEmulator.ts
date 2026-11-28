// Server emulator (M6-5): takes the place of the server (M2) for the board.
//
// The link itself is the M2-4 board link (M2-network/src/board/boardLink.ts),
// the code the real server uses, with its network emulator for delay, jitter
// and loss. On top of it this file adds what M1 would give: test board states
// from the scenario, config, vibrate commands, and it collects what the board
// sends: earthquake events, the seismic signal and the status reports.
// An earthquake event from the board starts the shock wave in the scenario,
// like the real game does.

import { BoardLink, type QuakeEvent } from "../../../../M2-network/src/board/boardLink.js";
import { NetemSettings, type QueueSettings } from "../../../../M2-network/src/netem/netem.js";
import { loadCityPlan, zoneCentre, type CityPlan } from "../common/cityPlan.js";
import { DEFAULT_PORT } from "../common/protocol.js";
import { Scenario, type ScenarioOptions } from "./scenario.js";

export interface ServerEmulatorOptions {
  port?: number;
  host?: string;
  /** Board states per second, 10–30 (admin parameter `board.state_hz`). */
  stateHz?: number;
  seed?: number;
  scenario?: ScenarioOptions;
  plan?: CityPlan;
  /** Start an earthquake in the scenario for every event from the board (default true). */
  quakeFromBoard?: boolean;
  events?: {
    quake?(e: QuakeEvent): void;
    link?(connected: boolean): void;
    status?(d: Record<string, unknown>): void;
  };
}

/** Config of the vectors (board_protocol_vectors.json, `C`), with the plan version of the city plan. */
export function defaultConfig(plan: CityPlan): Record<string, unknown> {
  return {
    plan: plan.version,
    bright: 0.6,
    max_ma: 4000,
    tones: [
      [80, 160, 255],
      [0, 60, 220],
      [90, 255, 90],
      [0, 150, 40],
      [200, 110, 255],
      [110, 0, 200],
      [255, 230, 80],
      [210, 140, 0],
    ],
    anim: { tail: 2, dp_blink_hz: 1.5 },
  };
}

export class ServerEmulator {
  readonly plan: CityPlan;
  readonly scenario: Scenario;
  readonly netem = new NetemSettings();
  readonly link: BoardLink;
  readonly quakes: QuakeEvent[] = [];
  /** Newest sensor values for the seismic signal, oldest first. */
  readonly seismic: number[] = [];
  lastStatus?: Record<string, unknown>;
  sensorMessages = 0;
  statusMessages = 0;
  port = 0;
  private config: Record<string, unknown>;
  private tick?: NodeJS.Timeout;
  private stateHz: number;

  constructor(private readonly options: ServerEmulatorOptions = {}) {
    this.plan = options.plan ?? loadCityPlan();
    this.scenario = new Scenario(this.plan, { seed: options.seed ?? 1, ...options.scenario });
    this.config = defaultConfig(this.plan);
    this.stateHz = options.stateHz ?? 30;
    const ev = options.events ?? {};
    this.link = new BoardLink({
      port: options.port ?? DEFAULT_PORT,
      host: options.host ?? "0.0.0.0",
      stateHz: this.stateHz,
      netem: this.netem,
      events: {
        quake: (e) => {
          this.quakes.push(e);
          if (this.options.quakeFromBoard ?? true) {
            // M1 uses the centre of the zone, not the measured place (doc 5.5).
            const c = zoneCentre(e.zone);
            this.scenario.startQuake(c.u, c.v, e.mag);
          }
          ev.quake?.(e);
        },
        sensor: (e) => {
          this.sensorMessages++;
          this.seismic.push(...e.a);
          if (this.seismic.length > 600) this.seismic.splice(0, this.seismic.length - 600);
        },
        status: (d) => {
          this.statusMessages++;
          this.lastStatus = d;
          ev.status?.(d);
        },
        link: (c) => ev.link?.(c),
      },
    });
  }

  async start(): Promise<number> {
    this.link.setConfig(this.config);
    this.link.setState(this.scenario.boardState());
    this.port = await this.link.start();
    const dt = 1 / 30;
    this.tick = setInterval(() => {
      this.scenario.step(dt);
      this.link.setState(this.scenario.boardState());
    }, 1000 * dt);
    return this.port;
  }

  /** Vibrate command (mask bits: zone 0, 2, 6, 8). False when no board is connected. */
  vibrate(mask = 15, duty = 0.8, ms = 1500, rampMs = 200): boolean {
    return this.link.vibrate({ mask, duty, ms, ramp_ms: rampMs });
  }

  /** Changes the config and sends it to the board. */
  setConfig(patch: Record<string, unknown>): void {
    this.config = { ...this.config, ...patch };
    this.link.setConfig(this.config);
  }

  get currentConfig(): Readonly<Record<string, unknown>> {
    return this.config;
  }

  /** Delay, jitter and loss on the board link, `down` = server → board. */
  setNet(dir: "up" | "down", patch: Partial<QueueSettings>): void {
    this.netem.set("board", dir, patch);
  }

  net(dir: "up" | "down"): QueueSettings {
    return this.netem.get("board", dir);
  }

  setStateHz(hz: number): void {
    this.stateHz = Math.min(30, Math.max(10, hz));
    this.link.setStateHz(this.stateHz);
  }

  get currentStateHz(): number {
    return this.stateHz;
  }

  metrics() {
    return this.link.metrics();
  }

  async close(): Promise<void> {
    if (this.tick) clearInterval(this.tick);
    await this.link.close();
  }
}
