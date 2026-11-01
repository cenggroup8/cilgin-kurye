# Çılgın Kurye

Multiplayer motorcycle courier game with a real-time LED city board.
CSE 396 Project, Gebze Technical University, Group 8 (Board&Byte).

Players drive in a 3D city on their phones, but the only map is a physical
60 × 60 cm LED board on the table. An admin computer changes game parameters
live and watches the results in the 3D city, on the board and in graphs.

## Repository layout

| Folder | Modules | Content |
| --- | --- | --- |
| `contracts/` | all | Shared city plan, message formats, protocol test vectors. **Changes need approval from every module that uses them.** |
| `server/` | M1, M2, M3, M4 | Game server, network, physics, traffic and AI |
| `client/` | M5 | Phone web client (Three.js) |
| `admin/` | M6 | Admin panel and live graphs |
| `firmware/` | M7, M8 | ESP32 firmware: board link, sensor, motors, LED animation engine |
| `tools/` | all | Generators, checkers and emulators (`server_emu.py`, `board_emu.py`, `make_led_map.py`) |
| `hardware/` | M7, M8 | Wiring diagrams, parts list, 3D models (STL) |
| `docs/` | all | Proposals, reports, meeting notes |

## Modules and members

| Module | Name | Members |
| --- | --- | --- |
| M1 | Game Server and Rules | Tuğberk Akbulut, Abdullatif Yılmaz, Berk Andaçgil, Selim Barut, Umutcan Ocak |
| M2 | Network and Synchronization | Tuğberk Akbulut, Ayşe Poyraz, Hasan Hüseyin Özdemir, Umutcan Ocak |
| M3 | Physics and Collision | Abdullatif Yılmaz, Hasan Alperen Elmas, Batuhan Yanar, Selim Barut |
| M4 | Traffic and AI | Hasan Alperen Elmas, Batuhan Yanar, Muhib Taha Boy |
| M5 | Player Client and 3D City | Abdullatif Yılmaz, Berk Andaçgil, Selim Barut |
| M6 | Admin Panel and Monitoring | Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil |
| M7 | ESP32 Software and Communication | Tuğberk Akbulut, Hasan Alperen Elmas, Hasan Hüseyin Özdemir, Muhib Taha Boy |
| M8 | LED Animation and Physical Board | Ayşe Poyraz, Hasan Hüseyin Özdemir, Muhib Taha Boy, Umutcan Ocak |

## How we work

1. Every task is an issue on the GitHub Project board, labelled with its module (`M1` … `M8`).
2. Work on a branch named `<module>/<short-topic>`, for example `m4/npc-traffic` or `m7/udp-link`.
3. Open a pull request into `main`. At least one reviewer **from another module** approves before merging.
4. Nobody pushes directly to `main`. (Branch protection is not enforced on a private free repository, so this is a team rule.)
5. A change in `contracts/` needs the `contracts` label and approval from every module that uses the file. Increase the version number in the file.

## Shared contracts

Run these after changing anything in `contracts/` or `tools/`:

```bash
pip install msgpack
python3 tools/gen_city_plan.py         # regenerate contracts/city_plan.json
python3 tools/gen_protocol_vectors.py  # regenerate contracts/board_protocol_vectors.json
python3 tools/check_contracts.py       # the same check that CI runs
```

See [`contracts/README.md`](contracts/README.md) for the ID rules and coordinates.
