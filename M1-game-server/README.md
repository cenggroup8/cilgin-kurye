# M1 Game Server and Rules

M1 is the brain of the game. It runs on the main computer and it is the only part that can change the game. It keeps the game clock and the one true game state. It knows every team, store, package, delivery point, score, fall, obstacle and earthquake. Phones only send their buttons. M1 decides what happens, and then everybody sees the same result.

| Runs on | Technology | Requirements |
|---|---|---|
| Main computer, in one server program together with M2 and M3 | TypeScript on Node.js, a fixed step game loop with 30 ticks per second, seeded random numbers, JSON files for the city plan and the game log | R1 R2 R4 R5 R6 R7 R9 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Controls | M2, from phones | Throttle and brake from 0 to 1, steer from −1 to 1, a control number. “Find me” comes as an event |
| In | Join | M2, from phones | Player key, name, team. M2 also reports when a player is lost or comes back |
| In | Admin commands | M2, from admin | Parameter changes, start, pause, resume, end, reset, new game code, obstacles, earthquake |
| In | Board events | M2, from board | Source (hand or motors), strength from 0 to 10, zone, confidence |
| In | Traffic | M3 | NPC cars, bot controls, travel time table |
| In | Physics | M3 | New motorcycle poses, collision and fall events |
| Out | Game state | M2, to phones and admin | Every tick: phase, time, scores, players, NPC cars, obstacles, earthquake. For each player also the compass target, the “Find me” waiting time and the number of the last control that M1 used |
| Out | Board state | M2, to board | Phase, players, delivery points, obstacles and earthquake in board coordinates |
| Out | Metrics | M2, to admin | Twice per second: the values of all admin graphs |
| Out | Game log | Disk | The seed and, for every tick, the controls, admin commands and board events |

## Planned layout

```
src/        game loop, phases, rules, deliveries, penalties, obstacles, earthquake, admin commands
test/       rule tests with fake M2 and M3 and fixed test data
logs/       recorded games for replay tests (not in git)
```

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Tuğberk Akbulut, Abdullatif Yılmaz, Berk Andaçgil, Selim Barut, Umutcan Ocak

## Documents

- Module document v2.0: [PDF](../docs/proposals/M1-game-server/v2.0/M1-proposal.pdf) · [Markdown](../docs/proposals/M1-game-server/v2.0/M1-proposal.md)
- All modules in one document: [PDF](../docs/proposals/modules-and-requirements/v2.0/Cilgin_Kurye_Modules_and_Requirements.pdf)
- Shared message formats and city plan: [`contracts/`](../contracts/)
