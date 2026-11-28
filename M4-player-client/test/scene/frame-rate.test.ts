import assert from "node:assert/strict";
import { test } from "node:test";
import { FrameRate } from "../../src/scene/frame-rate.ts";

function run(rate: FrameRate, hz: number, seconds: number): { drawn: number; time: number } {
  let drawn = 0;
  let time = 0;
  const step = 1000 / hz;
  for (let now = 0; now < seconds * 1000; now += step) {
    const dt = rate.frame(now, step / 1000);
    if (dt !== null) {
      drawn++;
      time += dt;
    }
  }
  return { drawn, time };
}

test("without a limit every frame is drawn and the rate is measured", () => {
  const rate = new FrameRate();
  const { drawn } = run(rate, 120, 2);
  assert.ok(drawn >= 239 && drawn <= 241, `${drawn}`);
  assert.ok(Math.abs(rate.fps - 120) <= 2, `${rate.fps}`);
});

test("an admin limit of 30 draws about 30 times a second on a 120 Hz screen", () => {
  const rate = new FrameRate();
  rate.limit = 30;
  const { drawn, time } = run(rate, 120, 4);
  assert.ok(drawn >= 116 && drawn <= 124, `${drawn}`);
  assert.ok(Math.abs(rate.fps - 30) <= 2, `${rate.fps}`);
  assert.ok(Math.abs(time - 4) < 0.05, "skipped frames still give their time to the next drawn one");
});

test("a silly limit is kept in a safe range and 0 turns it off", () => {
  const rate = new FrameRate();
  rate.limit = 2;
  assert.equal(rate.limit, 10);
  rate.limit = 0;
  assert.equal(rate.limit, null);
});
