import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pack, unpack, type Msg } from "../fakes/boardServer.js";
import { REPO_DIR } from "../src/modules.js";

const vectors = JSON.parse(readFileSync(join(REPO_DIR, "contracts", "board_protocol_vectors.json"), "utf8")) as {
  vectors: { name: string; json: Msg; msgpack_hex: string }[];
};

describe("fake board server encoding (contracts/board_protocol_vectors.json)", () => {
  for (const v of vectors.vectors) {
    it(`${v.name}: same bytes as the contract`, () => {
      expect(Buffer.from(pack(v.json)).toString("hex")).toBe(v.msgpack_hex);
      expect(unpack(Buffer.from(v.msgpack_hex, "hex"))?.t).toBe(v.json.t);
    });
  }
});
