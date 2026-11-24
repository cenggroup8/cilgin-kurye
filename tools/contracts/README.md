# Contract tools

Scripts that generate and check the shared files in [`contracts/`](../../contracts).
Node.js 20 or newer.

```
cd tools/contracts
npm install
npm run gen      # writes contracts/city_plan.json and contracts/board_protocol_vectors.json
npm run check    # checks both files
```

| Script | What it does |
| --- | --- |
| `gen-city-plan.mjs` | Writes `city_plan.json` from the grid rules |
| `gen-protocol-vectors.mjs` | Writes `board_protocol_vectors.json`: one example of each board message and its exact MessagePack bytes |
| `check-contracts.mjs` | City plan IDs and geometry; every vector encodes to the same bytes and decodes back; the largest board state fits in one Wi-Fi packet |
| `protocol.mjs` | The encoding rule both scripts share |

These scripts replace the old Python ones. With the same input they give the same
bytes; the only change in the vectors is the new `sid` field and `dp_blink_hz`
1.5 instead of 1.0 (see the comment in `gen-protocol-vectors.mjs`).
