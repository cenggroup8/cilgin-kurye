import assert from "node:assert/strict";
import { test } from "node:test";
import { crossfadeLoop } from "../../src/scene/engine-audio.ts";

test("a loop with a jump at its end becomes seamless", () => {
  const input = new Float32Array(1000).map((_, i) => (i < 900 ? Math.sin(i / 10) : 1));
  const out = crossfadeLoop(input, 80);
  assert.equal(out.length, 920);
  const seam = Math.abs(out[out.length - 1] - out[0]);
  const step = Math.max(...Array.from(out.slice(1), (v, i) => Math.abs(v - out[i])));
  assert.ok(seam <= step + 1e-6, `seam ${seam} vs largest step ${step}`);
});
