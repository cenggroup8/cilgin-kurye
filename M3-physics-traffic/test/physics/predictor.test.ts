import { describe, expect, it } from 'vitest';
import {
  addBike,
  BIKE_STAGES,
  createWorld,
  EMPTY_STAGES,
  Predictor,
  stepPhysics,
  type BikeControl,
  type BikeState,
} from '../../src/physics/index.js';

const DT = 1 / 30;
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };
const START = { x: 0, y: 0, heading: 0 };

/** Controls that change all the time: gas, brake and both sides. */
function controlAt(t: number): BikeControl {
  return {
    throttle: t % 90 < 60 ? 1 : 0,
    brake: t % 90 >= 80 ? 1 : 0,
    steer: Math.round(Math.sin(t / 25) * 2) / 2,
    seq: t,
  };
}

interface Snapshot {
  bike: BikeState;
  lastSeq: number;
}

/**
 * A tiny fake server: a control sent by the phone at tick t is used at tick
 * t + latency (or never, if lost). The state of server tick s reaches the phone
 * at tick s + latency (or never, if lost).
 */
function simulate(opts: {
  ticks: number;
  latency: number;
  lostControl?: (t: number) => boolean;
  lostState?: (t: number) => boolean;
  control?: (t: number) => BikeControl;
}) {
  const { ticks, latency } = opts;
  const control = opts.control ?? controlAt;
  const server = createWorld();
  addBike(server, 0, START);
  const predictor = new Predictor(0, START);

  let serverControl: BikeControl = { throttle: 0, brake: 0, steer: 0, seq: -1 };
  const serverStates: Snapshot[] = [];
  const predicted: BikeState[] = [];

  for (let t = 0; t < ticks + latency; t++) {
    // Server tick t: use the newest control that has arrived.
    const sentAt = t - latency;
    if (sentAt >= 0 && !opts.lostControl?.(sentAt)) serverControl = control(sentAt);
    const out = stepPhysics(
      server,
      {
        tick: t, dt: DT, obstacles: [], npcCars: [], quake: null, fall: [], standUp: [],
        bikes: [{ player: 0, speedFactor: 1, control: serverControl }],
      },
      STAGES,
    );
    serverStates.push({ bike: out.bikes[0], lastSeq: serverControl.seq });

    if (t >= ticks) continue;
    // Phone tick t: predict, then take the server state that arrives now.
    predictor.step(control(t));
    const s = t - latency;
    if (s >= 0 && !opts.lostState?.(s)) predictor.onServerState(serverStates[s].bike, serverStates[s].lastSeq);
    predicted.push({ ...predictor.bike });
  }
  return { predictor, serverStates, predicted };
}

const near = (a: BikeState, b: BikeState) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.heading).toBeCloseTo(b.heading, 9);
  expect(a.speed).toBeCloseTo(b.speed, 9);
};

describe('prediction on the phone', () => {
  it('with delay, the prediction is exactly where the server will be', () => {
    const latency = 4; // about 130 ms each way
    const { serverStates, predicted } = simulate({ ticks: 400, latency });
    // At phone tick t the prediction has used all controls up to t; the server uses
    // control t at server tick t + latency, so its state there must be the same.
    for (let t = 2 * latency; t < 400 - latency; t++) near(predicted[t], serverStates[t + latency].bike);
  });

  it('with lost server states, every state that arrives still gives the same place', () => {
    const latency = 3;
    const { serverStates, predicted } = simulate({ ticks: 300, latency, lostState: (s) => s % 3 === 1 || s % 7 === 0 });
    for (let t = 2 * latency; t < 300 - latency; t++) {
      if ((t - latency) % 3 === 1 || (t - latency) % 7 === 0) continue;
      near(predicted[t], serverStates[t + latency].bike);
    }
  });

  it('after lost controls it reaches the same place as the server again', () => {
    const latency = 3;
    const ticks = 400;
    // 10 % of the controls are lost until tick 300, then the rider holds one control.
    const control = (t: number): BikeControl => (t < 300 ? controlAt(t) : { throttle: 1, brake: 0, steer: 0.5, seq: t });
    const { serverStates, predicted } = simulate({ ticks, latency, control, lostControl: (t) => t < 300 && t % 10 === 3 });
    const t = ticks - latency - 1;
    near(predicted[t], serverStates[t + latency].bike);
  });

  it('forgets the controls that the server has used', () => {
    const { predictor } = simulate({ ticks: 200, latency: 4 });
    expect(predictor.pending).toBe(8);
  });
});

describe('correction', () => {
  function moving(): Predictor {
    const p = new Predictor(0, START);
    for (let t = 0; t < 30; t++) p.step({ throttle: 1, brake: 0, steer: 0, seq: t });
    return p;
  }

  it('blends a small difference away without a jump', () => {
    const p = moving();
    const before = p.drawPose();
    p.onServerState({ ...p.bike, x: p.bike.x - 1 }, 29);
    expect(p.drawPose().x).toBeCloseTo(before.x, 9);
    for (let t = 30; t < 50; t++) p.step({ throttle: 1, brake: 0, steer: 0, seq: t });
    expect(Math.abs(p.drawPose().x - p.bike.x)).toBeLessThan(0.01);
  });

  it('jumps at once when the difference is large', () => {
    const p = moving();
    p.onServerState({ ...p.bike, x: p.bike.x - 10 }, 29);
    expect(p.drawPose().x).toBe(p.bike.x);
  });

  it('shows the server pose for a fallen motorcycle and does not move it', () => {
    const p = moving();
    const server = { ...p.bike, x: 5, y: 2, speed: 0, fallen: true };
    p.onServerState(server, 29);
    p.step({ throttle: 1, brake: 0, steer: 1, seq: 30 });
    const pose = p.drawPose();
    expect([pose.x, pose.y, pose.fallen]).toEqual([5, 2, true]);
    expect(p.pending).toBe(0);
  });
});
