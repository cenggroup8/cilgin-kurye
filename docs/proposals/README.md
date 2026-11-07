# Proposals

Each module has its own folder, and **every version of a proposal lives in its own folder**.
A version folder is never changed after it is merged into `main`; a change always means a new folder.
This way every version we ever wrote or submitted stays readable side by side.

## Current versions

| Module | Folder | Latest | Status |
| --- | --- | --- | --- |
| Project | [`project/`](project/) | [v1.0](project/v1.0/) | Submitted |
| M1 Game Server and Rules | [`M1-game-server/`](M1-game-server/) | [v1.1](M1-game-server/v1.1/) | v1.0 submitted, v1.1 updated |
| M2 Network and Synchronization | [`M2-network/`](M2-network/) | [v1.0](M2-network/v1.0/) | Submitted |
| M3 Physics and Collision | [`M3-physics/`](M3-physics/) | [v1.0](M3-physics/v1.0/) | Submitted |
| M4 Traffic and AI | [`M4-traffic-ai/`](M4-traffic-ai/) | [v1.1](M4-traffic-ai/v1.1/) | v1.0 submitted, v1.1 updated |
| M5 Player Client and 3D City | [`M5-player-client/`](M5-player-client/) | [v1.1](M5-player-client/v1.1/) | v1.0 submitted, v1.1 updated |
| M6 Admin Panel and Monitoring | [`M6-admin-panel/`](M6-admin-panel/) | [v1.1](M6-admin-panel/v1.1/) | v1.0 submitted, v1.1 updated |
| M7 ESP32 Software and Communication | [`M7-esp32-communication/`](M7-esp32-communication/) | [v1.0](M7-esp32-communication/v1.0/) | Submitted |
| M8 LED Animation and Physical Board | [`M8-led-board/`](M8-led-board/) | [v1.1](M8-led-board/v1.1/) | v1.0 submitted, v1.1 updated |
| Modules and requirements (all in one) | [`modules-and-requirements/`](modules-and-requirements/) | [v1.1](modules-and-requirements/v1.1/) | v1.0 submitted, v1.1 updated |

Update this table in the same pull request that adds a new version.

## Folder layout

```
M4-traffic-ai/
├── CHANGELOG.md          what changed in each version, newest first
├── v0.1/
│   ├── M4-proposal.md    source text (git shows changes line by line)
│   └── M4-proposal.pdf   the readable / submitted version, with diagrams
└── v0.2/
    ├── M4-proposal.md
    └── M4-proposal.pdf
```

## Version numbers

| Version | Meaning |
| --- | --- |
| `v0.1`, `v0.2`, … | Drafts inside the group, before submission |
| `v1.0` | The version submitted to the instructor |
| `v1.1`, `v1.2`, … | After submission: wording, clarifications, more detail. **Inputs and outputs do not change.** |
| `v2.0`, `v3.0`, … | After submission: a change to inputs, outputs, message formats or anything in `contracts/` |

## How to add a new version

1. Copy the latest version folder to the next number, for example `v0.1` → `v0.2`.
2. Edit only the files in the new folder. Never edit or delete an older version folder.
3. Add an entry at the top of the module's `CHANGELOG.md`: version, date, what changed, why, who approved.
4. Update the "Current versions" table above.
5. Open a pull request. A **major** version (`v2.0` and up) also needs:
   - approval from every module whose inputs or outputs it touches, and
   - the matching change in `contracts/` in the same pull request.
6. When a version is submitted, tag it: `git tag proposal/M4/v1.0 && git push --tags`.

The `proposals` CI check fails if a pull request changes or deletes a file inside an existing version folder.
