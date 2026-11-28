// M6 adapter: one module, three parts. A scenario chooses the part with `params.part`:
//   link     M6-1, the link part of the board program            (Umutcan, link.ts)
//   sensor   M6-2, hit sensor and motors                          (Muhib, to come)
//   leds     M6-3, LED part and power estimate                     (Muhib, to come)
import { existsSync } from "node:fs";
import type { Adapter, AdapterModule, Ctx } from "../../src/adapter.js";
import type { Scenario } from "../../src/scenario.js";
import { createLink, LINK_DIR } from "./link.js";

const PARTS: Record<string, () => Adapter> = {
  link: createLink,
};

export function create(): Adapter {
  let part: Adapter | null = null;
  return {
    start(s: Scenario, ctx: Ctx) {
      const name = String(s.params.part ?? "link");
      const make = PARTS[name];
      if (!make) throw new Error(`M6 has no part "${name}" yet (${Object.keys(PARTS).join(", ")})`);
      part = make();
      return part.start(s, ctx);
    },
    input(name, value) {
      part?.input?.(name, value);
    },
    async stop() {
      await part?.stop();
    },
  };
}

export function ready(): string | null {
  return existsSync(LINK_DIR) ? null : "M6-led-board/firmware/test/link is missing";
}

export default { create, ready } satisfies AdapterModule;
