#!/usr/bin/env python3
"""Generate contracts/board_protocol_vectors.json (M7 board protocol, version 1).

Each vector holds a message as JSON and its exact MessagePack bytes in hex.
The ESP32 firmware, the server (M2) and the PC tools must all encode and
decode every vector identically before integration.

Run:  python3 tools/gen_protocol_vectors.py   (needs: pip install msgpack)
"""
import json
from pathlib import Path

import msgpack

VECTORS = {
    "state": {"t": "S", "v": 1, "seq": 52031, "ts": 60800, "d": {
        "ph": 2, "tl": 239,
        "p": [[2, 1, 0, 13, 0.4248, 0.1962, 88, 11.2],
              [5, 3, 1, 17, 0.82, 0.6004, 180, 7.9]],
        "dp": [[2, 0.7, 0.304, 0]],
        "ob": [[12, 2, 0], [41, 3, 1], [20, 1, 0]],
        "eq": [1, 0.52, 0.48, 7, 840]}},
    "config": {"t": "C", "v": 1, "seq": 4, "ts": 0, "ack": True, "d": {
        "plan": "0.1.0", "bright": 0.6, "max_ma": 4000,
        "tones": [[80, 160, 255], [0, 60, 220], [90, 255, 90], [0, 150, 40],
                  [200, 110, 255], [110, 0, 200], [255, 230, 80], [210, 140, 0]],
        "anim": {"tail": 2, "dp_blink_hz": 1.0}}},
    "vibrate": {"t": "V", "v": 1, "seq": 9, "ts": 61200, "ack": True,
                "d": {"mask": 5, "duty": 0.8, "ms": 1500, "ramp_ms": 200}},
    "ping": {"t": "P", "v": 1, "seq": 620, "ts": 60790, "d": {}},
    "hello": {"t": "H", "v": 1, "seq": 1, "ts": 1200,
              "d": {"fw": "0.4.1", "plan": "0.1.0", "board": "board-01"}},
    "quake": {"t": "Q", "v": 1, "seq": 77, "ts": 123456, "ack": True,
              "d": {"id": 12, "src": "hit", "peak_g": 3.8, "mag": 6.1,
                    "u": 0.31, "v": 0.72, "zone": 6, "conf": 0.7}},
    "sensor": {"t": "N", "v": 1, "seq": 9001, "ts": 123400,
               "d": {"hz": 100, "a": [0.01, 0.02, 0.01, 0.85, 2.9, 3.8, 1.2, 0.4, 0.1, 0.03]}},
    "status": {"t": "T", "v": 1, "seq": 310, "ts": 310020,
               "d": {"fw": "0.4.1", "plan": "0.1.0", "last_seq": 52031, "fps": 60,
                     "rssi": -52, "ma_est": 1850, "heap": 182000, "err": []}},
    "pong": {"t": "O", "v": 1, "seq": 620, "ts": 310050,
             "d": {"ping_ts": 60790, "state_seq": 52031, "state_age_ms": 9}},
    "ack": {"t": "A", "v": 1, "seq": 77, "ts": 123470, "d": {}},
}


def pack(msg):
    # Floats as float32: the ESP32 side uses float, and it halves the size.
    return msgpack.packb(msg, use_single_float=True)


out = {"protocol_version": 1,
       "encoding": "MessagePack, maps with string keys, floats as float32",
       "vectors": [{"name": k, "json": v, "msgpack_hex": pack(v).hex(), "bytes": len(pack(v))}
                   for k, v in VECTORS.items()]}

path = Path(__file__).resolve().parent.parent / "contracts" / "board_protocol_vectors.json"
path.write_text(json.dumps(out, indent=2) + "\n")
for v in out["vectors"]:
    print(f"{v['name']:8s} {v['bytes']:4d} bytes")
print(f"wrote {path}")
