#!/usr/bin/env python3
"""Check the shared contracts. Runs in CI on every change to contracts/ or tools/.

- city_plan.json follows the ID formulas and grid geometry
- every protocol vector round-trips through MessagePack byte for byte
- the worst-case STATE message fits in one Wi-Fi packet (< 1400 bytes)
"""
import json
import sys
from pathlib import Path

import msgpack

ROOT = Path(__file__).resolve().parent.parent
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


# --- city plan -------------------------------------------------------------
plan = json.loads((ROOT / "contracts" / "city_plan.json").read_text())
L, P = plan["grid"]["lines"], plan["grid"]["pitch_m"]
check(len(plan["nodes"]) == L * L, "node count")
check(len(plan["segments"]) == 2 * L * (L - 1), "segment count")
nodes = {n["id"]: n for n in plan["nodes"]}
for n in plan["nodes"]:
    r, c = map(int, n["name"].split("_")[1:])
    check(n["id"] == 6 * r + c, f"node id {n['name']}")
    check((n["x"], n["z"]) == (c * P, r * P), f"node position {n['name']}")
for s in plan["segments"]:
    kind, r, c = s["name"][0], *map(int, s["name"].split("_")[1:])
    want = 5 * r + c if kind == "h" else 30 + 6 * r + c
    check(s["id"] == want, f"segment id {s['name']}")
    a, b = nodes[s["a"]], nodes[s["b"]]
    check(abs(a["x"] - b["x"]) + abs(a["z"] - b["z"]) == s["length_m"], f"segment length {s['name']}")
seg_ids = {s["id"] for s in plan["segments"]}
for d in plan["delivery_candidates"]:
    check(d["segment"] in seg_ids and 0 <= d["t"] <= 1, f"delivery candidate {d['id']}")
check(sorted(s["team"] for s in plan["stores"]) == [0, 1, 2, 3], "stores")

# --- protocol vectors ------------------------------------------------------
vec = json.loads((ROOT / "contracts" / "board_protocol_vectors.json").read_text())
for v in vec["vectors"]:
    raw = bytes.fromhex(v["msgpack_hex"])
    check(msgpack.packb(v["json"], use_single_float=True) == raw, f"vector {v['name']} encode")
    back = msgpack.unpackb(raw)
    check(back["t"] == v["json"]["t"] and back["seq"] == v["json"]["seq"], f"vector {v['name']} decode")

worst = {"t": "S", "v": 1, "seq": 4294967295, "ts": 4294967295, "d": {
    "ph": 2, "tl": 300,
    "p": [[i, i // 2, i % 2, 31, 0.123456, 0.654321, 359.9, 19.99] for i in range(8)],
    "dp": [[i, 0.123456, 0.654321, 1] for i in range(8)],
    "ob": [[s, 3, 2] for s in range(60)],
    "eq": [1, 0.5, 0.5, 10, 65535]}}
size = len(msgpack.packb(worst, use_single_float=True))
check(size < 1400, f"worst-case STATE is {size} bytes (limit 1400)")

if errors:
    print("Contract check FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"Contracts OK: {len(plan['nodes'])} nodes, {len(plan['segments'])} segments, "
      f"{len(vec['vectors'])} protocol vectors, worst-case STATE {size} bytes")
