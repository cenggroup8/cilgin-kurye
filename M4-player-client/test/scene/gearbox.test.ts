import assert from "node:assert/strict";
import { test } from "node:test";
import { Gearbox } from "../../src/scene/gearbox.ts";

function drive(box: Gearbox, from: number, to: number, accel: number, top = 15): string[] {
  const shifts: string[] = [];
  const dt = 1 / 60;
  for (let v = from; accel > 0 ? v <= to : v >= to; v += accel * dt) {
    const s = box.update(v, accel, top, dt);
    if (s) shifts.push(`${s}${box.gear}`);
  }
  return shifts;
}

test("a hard start does not jump through the gears: each gear is held for a while", () => {
  const box = new Gearbox();
  const dt = 1 / 60;
  let v = 0;
  const times: number[] = [];
  for (let t = 0; t < 12; t += dt) {
    v += 6 * (1 - v / 15) * dt;
    if (box.update(v, 6 * (1 - v / 15), 15, dt) === "up") times.push(t);
  }
  assert.equal(times.length, 4);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] > 0.9, `${times}`);
});

test("speeding up to top speed goes up through the gears one by one", () => {
  const box = new Gearbox();
  assert.deepEqual(drive(box, 0, 14.9, 1.5), ["up2", "up3", "up4", "up5"]);
});

test("the revs drop right after an upshift and climb again in the gear", () => {
  const box = new Gearbox();
  const dt = 1 / 60;
  let before = 0;
  for (let v = 0; v < 15; v += 0.05) {
    const r = box.rpm;
    if (box.update(v, 4, 15, dt) === "up") before = r;
    if (before && box.gear === 2) break;
  }
  for (let i = 0; i < 20; i++) box.update(5.6, 4, 15, dt);
  assert.ok(box.rpm < before - 0.2, `${box.rpm} vs ${before}`);
});

test("slowing down shifts down, and a small wobble at a shift point does not flip gears", () => {
  const box = new Gearbox();
  drive(box, 0, 14.9, 1.5);
  assert.deepEqual(drive(box, 14.9, 0, -3), ["down4", "down3", "down2", "down1"]);
  const wobble = new Gearbox();
  drive(wobble, 0, 5.4, 1.5);
  const flips = [5.3, 5.4, 5.25, 5.4, 5.3].map((v) => wobble.update(v, 0, 15, 1 / 60)).filter(Boolean);
  assert.equal(flips.length, 0);
});
