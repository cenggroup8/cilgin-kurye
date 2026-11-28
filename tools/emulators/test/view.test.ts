import { describe, expect, it } from "vitest";
import { layout, renderBoard, snapToRoad } from "../src/board/view.js";

const lit = (lines: string[]) => lines.join("").split("o ").length - 1;

describe("board view", () => {
  it("has L LEDs on each of the 60 segments and 2 LEDs in each store", () => {
    for (const L of [5, 6, 7]) {
      const { cells } = layout(L);
      const all = cells.flat().filter(Boolean);
      expect(all.filter((c) => c!.kind === "led")).toHaveLength(60 * L);
      expect(all.filter((c) => c!.kind === "store")).toHaveLength(8);
      const segs = new Set(all.filter((c) => c!.kind === "led").map((c) => c!.seg));
      expect(segs.size).toBe(60);
    }
  });

  it("numbers the segments like contracts/README.md", () => {
    const { cells } = layout(6);
    expect(cells[0][1]?.seg).toBe(0); // h_0_0
    expect(cells[0][8]?.seg).toBe(1); // h_0_1
    expect(cells[1][0]?.seg).toBe(30); // v_0_0
    expect(cells[1][7]?.seg).toBe(31); // v_0_1
    expect(cells[8][0]?.seg).toBe(36); // v_1_0
  });

  it("puts a position on the nearest road", () => {
    const p = snapToRoad(0.31, 0.205, 6);
    expect(p.y % 7 === 0 || p.x % 7 === 0).toBe(true);
  });

  it("searching: only the 8 store LEDs are on", () => {
    expect(lit(renderBoard({ link: "searching", nowMs: 750, plain: true }))).toBe(8);
  });

  it("lobby: roads dark, stores on; game: roads, obstacles and dots on", () => {
    expect(lit(renderBoard({ link: "connected", nowMs: 0, plain: true, state: { ph: 0, tl: 0, p: [], dp: [], ob: [], eq: [] } }))).toBe(8);
    const game = renderBoard({ link: "connected", nowMs: 0, plain: true, state: { ph: 2, tl: 100, p: [[0, 0, 0, 1, 0.5, 0.3, 90, 10]], dp: [], ob: [[12, 2, 0]], eq: [] } });
    expect(lit(game)).toBe(60 * 5 + 8);
  });
});
