// node --test tools/make_led_map/make-led-map.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildMap, renderHeader } from "./make-led-map.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => JSON.parse(readFileSync(root + p, "utf8"));
const plan = read("contracts/city_plan.json");
const layout = () => read("M6-led-board/hardware/strip_layout.json");

test("the strip layout and the city plan give 788 LEDs on 60 roads and 4 stores", () => {
  const map = buildMap(plan, layout());
  assert.equal(map.leds.length, 788);
  assert.deepEqual(map.chainLeds, [398, 390]);
  assert.equal(map.segmentInfo.length, 60);
  assert.equal(map.leds.filter((l) => l.store >= 0).length, 8);
  assert.match(renderHeader(map), /constexpr uint16_t kLedCount = 788;/);
});

test("a broken layout is refused with the reason", () => {
  const missing = layout();
  missing.chains[1].pieces.pop();
  assert.throws(() => buildMap(plan, missing), /segment 35 \(v_0_5\) has no LEDs/);

  const twice = layout();
  twice.chains[0].pieces[1].segment = 1;
  twice.chains[0].pieces[1].name = "h_0_1";
  assert.throws(() => buildMap(plan, twice), /segment 1 has two pieces/);

  const turned = layout();
  turned.chains[0].pieces[1].dir = "b_to_a";
  assert.throws(() => buildMap(plan, turned), /LED order does not follow b_to_a/);

  const gap = layout();
  gap.chains[0].pieces[2].first += 1;
  assert.throws(() => buildMap(plan, gap), /piece starts at/);
});
