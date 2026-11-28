import { describe, expect, it } from "vitest";
import { catalog } from "../src/catalog.js";
import { provenance } from "../src/provenance.js";

describe("catalog and provenance", () => {
  it("every scenario file loads, every module has its about tables", async () => {
    const all = await catalog();
    for (const m of all) {
      expect(m.error).toBeNull();
      expect(m.about?.inputs.length).toBeGreaterThan(0);
    }
  });
  it("every source of a ready scenario is in the repository", async () => {
    for (const m of await catalog()) {
      for (const e of m.entries.filter((x) => x.state === "ready")) {
        const missing = provenance(e.scenario).sources.filter((s) => !s.exists).map((s) => s.file);
        expect(missing, `${m.mod} ${e.scenario.name}`).toEqual([]);
      }
    }
  });
});
