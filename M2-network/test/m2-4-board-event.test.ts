// Earthquake event of the board to the shape of the M2-2 input queue.

import { describe, expect, it } from "vitest";
import type { QuakeEvent } from "../src/board/boardLink.js";
import { toBoardEvent } from "../src/board/boardEvent.js";

const q = (src: QuakeEvent["src"]): QuakeEvent => ({ id: 7, src, mag: 6.5, zone: 4, conf: 0.8, u: 0.5, v: 0.5, peak_g: 1.2 });

describe("M2-4 toBoardEvent", () => {
  it("a hand hit becomes source hand, with the queue field names", () => {
    expect(toBoardEvent(q("hit"))).toEqual({ source: "hand", magnitude: 6.5, zone: 4, confidence: 0.8 });
  });

  it("a motor shake becomes source motors", () => {
    expect(toBoardEvent(q("motor")).source).toBe("motors");
  });

  it("keeps only the four fields of the queue", () => {
    expect(Object.keys(toBoardEvent(q("hit"))).sort()).toEqual(["confidence", "magnitude", "source", "zone"]);
  });
});
