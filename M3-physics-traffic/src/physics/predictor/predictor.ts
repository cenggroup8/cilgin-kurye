/**
 * Prediction on the phone (module document 7.5, "Prediction on the phone").
 *
 * The phone moves its own motorcycle at once with the same physics code, and
 * corrects it when a server state arrives: it takes the server pose, throws
 * away the controls that the server has already used and runs the remaining
 * controls again. A small difference is blended away in a short time, a large
 * one (for example after a crash the phone did not see) jumps at once.
 *
 * Rule for M4: call step() once per prediction tick, and give every tick a new,
 * larger control number (the number M4-2 sends). Otherwise the predictor cannot
 * tell which controls the server has already used.
 */
import { BIKE_STAGES } from '../bike/index.js';
import { wrapAngle } from '../bike/motion.js';
import type { BikeTuning } from '../bike/tuning.js';
import { EMPTY_STAGES, stepPhysics, type PhysicsStages } from '../step.js';
import type { BikeControl, BikeState, PhysicsParams } from '../types.js';
import { addBike, createWorld, type PhysicsWorld, type SurfaceProvider } from '../world.js';

export interface PredictorOptions {
  /** Tick length, s. The same as the server tick (1/30). */
  dt?: number;
  /** Time to blend a small difference away, s. */
  blendTime?: number;
  /** A difference larger than this, in metres, jumps at once. */
  snapDistance?: number;
  /** Most controls kept while no server state comes. */
  maxHistory?: number;
  params?: Partial<PhysicsParams>;
  tuning?: Partial<BikeTuning>;
  /** Ground on the phone (static colliders of M3-2 once they exist). */
  surfaceAt?: SurfaceProvider;
  /** Stages to run; the motorcycle model by default. */
  stages?: PhysicsStages;
}

/** The pose to draw: the predicted motorcycle plus the part of the last correction not blended away yet. */
export interface DrawPose {
  x: number;
  y: number;
  heading: number;
  speed: number;
  lean: number;
  sliding: boolean;
  fallen: boolean;
}

interface Entry {
  seq: number;
  control: BikeControl;
  speedFactor: number;
}

export class Predictor {
  readonly world: PhysicsWorld;
  readonly player: number;
  private readonly dt: number;
  private readonly blendTime: number;
  private readonly snapDistance: number;
  private readonly maxHistory: number;
  private readonly stages: PhysicsStages;
  private history: Entry[] = [];
  private tick = 0;
  /** What is still to blend away: drawn pose minus predicted pose. */
  private offset = { x: 0, y: 0, heading: 0 };

  constructor(player: number, start: { x: number; y: number; heading: number }, opts: PredictorOptions = {}) {
    this.player = player;
    this.dt = opts.dt ?? 1 / 30;
    this.blendTime = opts.blendTime ?? 0.15;
    this.snapDistance = opts.snapDistance ?? 3;
    this.maxHistory = opts.maxHistory ?? 90;
    this.stages = opts.stages ?? { ...EMPTY_STAGES, ...BIKE_STAGES };
    this.world = createWorld(opts.params, opts.tuning);
    if (opts.surfaceAt) this.world.surfaceAt = opts.surfaceAt;
    addBike(this.world, player, start);
  }

  /** The predicted motorcycle (without the blend). */
  get bike(): BikeState {
    return this.world.bikes.get(this.player)!;
  }

  /** Moves the own motorcycle one tick with this control and keeps the control. */
  step(control: BikeControl, speedFactor = 1): BikeState {
    const entry = { seq: control.seq, control, speedFactor };
    if (!this.bike.fallen) {
      this.history.push(entry);
      if (this.history.length > this.maxHistory) this.history.shift();
    }
    this.run(entry);
    // The rest of the last correction fades out.
    const k = Math.max(0, 1 - this.dt / this.blendTime);
    this.offset.x *= k;
    this.offset.y *= k;
    this.offset.heading *= k;
    return this.bike;
  }

  /**
   * A game state came from the server: `server` is the own motorcycle in it and
   * `lastSeq` the number of the last control the server used.
   */
  onServerState(server: BikeState, lastSeq: number): void {
    const before = this.drawPose();
    Object.assign(this.bike, server, { id: this.player });

    if (server.fallen) {
      // A fallen motorcycle is not predicted: the phone shows the server pose.
      this.history = [];
      this.offset = { x: 0, y: 0, heading: 0 };
      return;
    }

    this.history = this.history.filter((e) => e.seq > lastSeq);
    for (const e of this.history) this.run(e);

    const dx = before.x - this.bike.x;
    const dy = before.y - this.bike.y;
    if (Math.hypot(dx, dy) > this.snapDistance) {
      this.offset = { x: 0, y: 0, heading: 0 };
    } else {
      this.offset = { x: dx, y: dy, heading: wrapAngle(before.heading - this.bike.heading) };
    }
  }

  /** The pose M4 draws. */
  drawPose(): DrawPose {
    const b = this.bike;
    return {
      x: b.x + this.offset.x,
      y: b.y + this.offset.y,
      heading: wrapAngle(b.heading + this.offset.heading),
      speed: b.speed,
      lean: b.lean,
      sliding: b.sliding,
      fallen: b.fallen,
    };
  }

  /** Controls not yet confirmed by the server. */
  get pending(): number {
    return this.history.length;
  }

  private run(e: Entry): void {
    stepPhysics(
      this.world,
      {
        tick: this.tick++,
        dt: this.dt,
        bikes: [{ player: this.player, speedFactor: e.speedFactor, control: e.control }],
        obstacles: [],
        npcCars: [],
        quake: null,
        fall: [],
        standUp: [],
      },
      this.stages,
    );
  }
}
