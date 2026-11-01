# Server (main computer)

Runs the whole game. One process, four modules, each in its own folder with its own tests.

| Folder | Module | Calls / is called by |
| --- | --- | --- |
| `m1-game/` | M1 Game Server and Rules | Runs the tick loop; calls M3 and M4; sends state to M2 |
| `m2-network/` | M2 Network and Synchronization | Phones (WebSocket) and the board (UDP, see `contracts/`) |
| `m3-physics/` | M3 Physics and Collision | Called by M1 every tick |
| `m4-traffic/` | M4 Traffic and AI | Called by M1 every tick; pure library, JSON in / JSON out |

The server language is not chosen yet (proposed: TypeScript on Node.js 22 LTS).
When it is chosen, add `server/package.json` with an `npm test` script; the
`server` CI workflow then runs automatically.
