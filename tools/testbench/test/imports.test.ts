import { describe, expect, it } from "vitest";
import { checkImports } from "../src/checkImports.js";

describe("check-imports", () => {
  it("the adapters in the repository keep rule 1", () => {
    expect(checkImports()).toEqual([]);
  });
});
