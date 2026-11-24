# Çılgın Kurye

CSE 396 Project · Gebze Technical University · Group 8 · Board&Byte

Up to four teams deliver packages with motorcycles in a 3D city on their phones. There is no map on the phone, only a compass arrow. The real map is a 60 × 60 cm LED city board on the table. An admin computer changes the game while it runs and watches the results.

The only design document is [Modules and Requirements v2.1](docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf).

## Modules

| Module | Folder | Plan |
| --- | --- | --- |
| M1 Game Server and Rules | [`M1-game-server/`](M1-game-server) | #23 |
| M2 Network and Synchronization | [`M2-network/`](M2-network) | #24 |
| M3 Physics, Traffic and AI | [`M3-physics-traffic/`](M3-physics-traffic) | #25 |
| M4 Player Client and 3D City | [`M4-player-client/`](M4-player-client) | #26 |
| M5 Admin Panel and Monitoring | [`M5-admin-panel/`](M5-admin-panel) | #27 |
| M6 LED Board and ESP32 | [`M6-led-board/`](M6-led-board) | #28 |

## Repository layout

```
M1-game-server/       game loop, rules, phases, scores
M2-network/           web server, WebSocket, board link
M3-physics-traffic/   motorcycle physics, NPC traffic, AI bots
M4-player-client/     phone web page, 3D city
M5-admin-panel/       admin web page, live graphs
M6-led-board/         ESP32 program, LED drawing, wiring and 3D models
tools/                emulators and helper scripts
docs/                 Modules and Requirements v2.1
```

Each module folder has its own README with its inputs, outputs and folder layout. The work packages are in #21 and the open decisions are in #22.

## Commit rules

Only people are authors in this repository. Commit messages, pull requests and issues must not credit a coding assistant as an author or as the tool that wrote the change. The full rule is in [AGENTS.md](AGENTS.md), which coding agents read.

Turn on the local check once after cloning:

```
git config core.hooksPath .githooks
```

If your clone already has its own hooks in `.git/hooks`, this setting turns them off; in that case call `tools/commit-rules/check-ai-trailers.sh` from your own `commit-msg` hook instead. The `commit-rules` workflow checks every push and pull request again.
