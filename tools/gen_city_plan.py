#!/usr/bin/env python3
"""Generate contracts/city_plan.json from the fixed grid rules.

ID rules (see contracts/README.md):
  node    n_r_c  -> id = 6r + c            (0-35)
  segment h_r_c  -> id = 5r + c            (0-29, east-west, n_r_c -> n_r_(c+1))
  segment v_r_c  -> id = 30 + 6r + c       (30-59, north-south, n_r_c -> n_(r+1)_c)

Run:  python3 tools/gen_city_plan.py
"""
import json
from pathlib import Path

LINES = 6
PITCH_M = 100
SIZE_M = PITCH_M * (LINES - 1)  # 500

nodes = []
for r in range(LINES):
    for c in range(LINES):
        nodes.append({"id": 6 * r + c, "name": f"n_{r}_{c}", "x": c * PITCH_M, "z": r * PITCH_M})

segments = []
for r in range(LINES):
    for c in range(LINES - 1):
        segments.append({"id": 5 * r + c, "name": f"h_{r}_{c}", "a": 6 * r + c, "b": 6 * r + c + 1,
                         "dir": "EW", "length_m": PITCH_M})
for r in range(LINES - 1):
    for c in range(LINES):
        segments.append({"id": 30 + 6 * r + c, "name": f"v_{r}_{c}", "a": 6 * r + c, "b": 6 * (r + 1) + c,
                         "dir": "NS", "length_m": PITCH_M})
segments.sort(key=lambda s: s["id"])

# Stores sit inside the four corner blocks. Team order and colours follow the project proposal.
stores = [
    {"team": 0, "color": "blue",   "corner": "NW", "node": 0,  "pickup": {"x": 18,  "z": 18,  "radius_m": 10}},
    {"team": 1, "color": "green",  "corner": "NE", "node": 5,  "pickup": {"x": 482, "z": 18,  "radius_m": 10}},
    {"team": 2, "color": "purple", "corner": "SW", "node": 30, "pickup": {"x": 18,  "z": 482, "radius_m": 10}},
    {"team": 3, "color": "yellow", "corner": "SE", "node": 35, "pickup": {"x": 482, "z": 482, "radius_m": 10}},
]

# Draft: one delivery candidate at the middle of every segment. Side: E/W for NS roads, N/S for EW roads.
candidates = []
for s in segments:
    side = ("S" if s["id"] % 2 else "N") if s["dir"] == "EW" else ("E" if s["id"] % 2 else "W")
    candidates.append({"id": s["id"], "segment": s["id"], "t": 0.5, "side": side})

plan = {
    "version": "0.1.0",
    "status": "draft - frozen when all module proposals are approved",
    "world": {"size_m": SIZE_M, "origin": "n_0_0",
              "axes": "x east, z south, y up; heading degrees clockwise from north",
              "board_uv": "u = x / size_m, v = z / size_m"},
    "grid": {"lines": LINES, "pitch_m": PITCH_M, "lanes_per_direction": 2, "lane_width_m": 3.5},
    "nodes": nodes,
    "segments": segments,
    "stores": stores,
    "delivery_candidates": candidates,
}

out = Path(__file__).resolve().parent.parent / "contracts" / "city_plan.json"
out.write_text(json.dumps(plan, indent=2) + "\n")
print(f"wrote {out} ({len(nodes)} nodes, {len(segments)} segments, {len(candidates)} candidates)")
