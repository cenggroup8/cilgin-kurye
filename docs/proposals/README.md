# Proposals

Each module has its own folder, and **every version of a proposal lives in its own folder**.
A version folder is never changed after it is merged into `main`; a change always means a new folder.
This way every version we ever wrote or submitted stays readable side by side.

## Current versions

The project has six modules since v2.0.

| Module | Folder | Latest | Status |
| --- | --- | --- | --- |
| Project | [`project/`](project/) | [v1.0](project/v1.0/) | Submitted |
| M1 Game Server and Rules | [`M1-game-server/`](M1-game-server/) | [v2.0](M1-game-server/v2.0/) | In review |
| M2 Network and Synchronization | [`M2-network/`](M2-network/) | [v2.0](M2-network/v2.0/) | In review |
| M3 Physics, Traffic and AI | [`M3-physics-traffic/`](M3-physics-traffic/) | [v2.0](M3-physics-traffic/v2.0/) | In review |
| M4 Player Client and 3D City | [`M4-player-client/`](M4-player-client/) | [v2.0](M4-player-client/v2.0/) | In review |
| M5 Admin Panel and Monitoring | [`M5-admin-panel/`](M5-admin-panel/) | [v2.0](M5-admin-panel/v2.0/) | In review |
| M6 LED Board and ESP32 | [`M6-led-board/`](M6-led-board/) | [v2.0](M6-led-board/v2.0/) | In review |
| Modules and requirements (all in one) | [`modules-and-requirements/`](modules-and-requirements/) | [v2.1](modules-and-requirements/v2.1/) | In review |

### Earlier eight module structure (v1.x)

These modules were merged in v2.0 and their folders were removed. The submitted v1 documents
can still be read at the [last commit of the eight module structure](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/).
Their changelogs were copied into the new module's `CHANGELOG.md`.

| Old module | Folder | Last version | Continues in |
| --- | --- | --- | --- |
| M3 Physics and Collision | [`M3-physics/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M3-physics) | [v1.0](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M3-physics/v1.0) | M3 |
| M4 Traffic and AI | [`M4-traffic-ai/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M4-traffic-ai) | [v1.1](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M4-traffic-ai/v1.1) | M3 |
| M5 Player Client and 3D City | [`M5-player-client/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M5-player-client) | [v1.1](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M5-player-client/v1.1) | M4 |
| M6 Admin Panel and Monitoring | [`M6-admin-panel/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M6-admin-panel) | [v1.1](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M6-admin-panel/v1.1) | M5 |
| M7 ESP32 Software and Communication | [`M7-esp32-communication/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M7-esp32-communication) | [v1.0](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M7-esp32-communication/v1.0) | M6 |
| M8 LED Animation and Physical Board | [`M8-led-board/`](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M8-led-board) | [v1.1](https://github.com/cenggroup8/cilgin-kurye/tree/0501c57f2874f9e49267aca2daff76bf8f56db17/docs/proposals/M8-led-board/v1.1) | M6 |

Update this table in the same pull request that adds a new version.

## Folder layout

```
M4-player-client/
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
   The only exception: when a module is merged into another one, its whole folder is removed
   and its changelog is copied into the new module's `CHANGELOG.md`.
3. Add an entry at the top of the module's `CHANGELOG.md`: version, date, what changed, why, who approved.
4. Update the "Current versions" table above.
5. Open a pull request. A **major** version (`v2.0` and up) also needs:
   - approval from every module whose inputs or outputs it touches, and
   - the matching change in `contracts/` in the same pull request.
6. When a version is submitted, tag it: `git tag proposal/M4/v1.0 && git push --tags`.

The `proposals` CI check fails if a pull request changes a file inside an existing version folder,
or deletes one while the module folder still exists.
