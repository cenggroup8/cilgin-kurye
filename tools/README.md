# Tools

| Script | Purpose | Status |
| --- | --- | --- |
| `gen_city_plan.py` | Generates `contracts/city_plan.json` | Ready |
| `gen_protocol_vectors.py` | Generates `contracts/board_protocol_vectors.json` | Ready |
| `check_contracts.py` | Checks both contract files (runs in CI) | Ready |
| `server_emu.py` | Pretends to be the server for board tests (M6) | Planned |
| `board_emu.py` | Pretends to be the LED board for server tests (M6) | Planned |
| `make_led_map.py` | Builds the LED map from the city plan (M6) | Planned |

Requires Python 3.10+ and `pip install msgpack`.
