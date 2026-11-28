import { describe, expect, it } from "vitest";
import { loadScenarios, withChanges } from "../src/scenario.js";

describe("values changed before Başlat", () => {
  it("changes only edit: params, inside their bounds, and lists the changes", async () => {
    const s = (await loadScenarios("m2")).find((x) => x.name === "3-loss30")!;
    const ok = withChanges(s, { loss_pct: 45, delay_ms: 50 });
    expect(typeof ok).toBe("object");
    if (typeof ok === "string") return;
    expect(ok.scenario.params.loss_pct).toBe(45);
    expect(ok.changes).toEqual([{ name: "loss_pct", from: 30, to: 45 }, { name: "delay_ms", from: 0, to: 50 }]);
    expect(s.params.loss_pct).toBe(30); // the scenario itself stays as it is
    expect(withChanges(s, { loss_pct: 99 })).toMatch(/0 … 50/);
    expect(withChanges(s, { part: "x" })).toMatch(/cannot be changed/);
  });
  it("a select takes only its options", async () => {
    const s = (await loadScenarios("m6")).find((x) => x.name === "link-1-clean")!;
    expect(withChanges(s, { state_hz: 25 })).toMatch(/10, 20, 30/);
    const ok = withChanges(s, { state_hz: "20" });
    expect(typeof ok !== "string" && ok.scenario.params.state_hz).toBe(20);
  });
});
