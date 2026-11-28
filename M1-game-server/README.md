# M1 Game Server and Rules

M1 is the brain of the game. It runs on the main computer and it is the only part that can change the game. It keeps the game clock and the one true game state. It knows every team, store, package, delivery point, score, fall, obstacle and earthquake. Phones only send their buttons. M1 decides what happens, and then everybody sees the same result.

| Runs on | Technology | Requirements |
|---|---|---|
| Main computer, in one server program together with M2 and M3 | TypeScript on Node.js, a fixed step game loop with 30 ticks per second, seeded random numbers, JSON files for the city plan and the game log | R1 R2 R4 R5 R6 R7 R9 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Controls | M2, from phones | Throttle and brake from 0 to 1, steer from −1 to 1, a control number. “Find me” comes as an event |
| In | Join | M2, from phones | Player key, player number (from M2-1's `welcome`), name, team. M2 also reports when a player is lost or comes back |
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
src/
  loop/       M1-1  game loop, tick order, seeded random numbers
  state/      M1-1  world state, state builder, metrics, game log
  match/      M1-2  phases, lobby, bot fill, lost players
  delivery/   M1-3  package, delivery point, score, compass target, "Find me"
  hazards/    M1-4  penalties, obstacles, earthquake
  admin/      M1-5  admin commands, parameter registry
test/
  fakes/      M1-1  fake M2 and fake M3
  scenarios/        demo scenario and rule test inputs
logs/               recorded games (not in git)
```

Each part can be built and tested alone with test data, as the module document describes.

## Run and test

Node.js 20 or newer.

```
npm install
npm test            # all tests
npm run demo:match  # M1-2: a scripted match with the real times, printed second by second
```

## M1-2: match and lobby (`src/match/match.ts`)

The `Match` class owns the game phase and the roster. It reads no clock and makes no random
numbers: time comes only from `tick()`, so the same inputs always give the same match.

| Part | What it does |
|---|---|
| Phases | lobby → countdown (3 s) → playing (at most 5 min) → ended; paused from countdown or playing |
| Lobby | `join(key, playerNo, name, team)`: the number is the one M2-1 gave the phone; at most 2 per team, 8 in total; a player may change team while there is room. Bots get the free numbers from the top (7, 6, …) |
| Bots | `start(botCount)`: fills empty places with up to `botCount` bots, each in the smallest team |
| Pause | `pause()` / `resume()`: game time and the wait of lost players stop; a pause in the countdown starts the countdown again |
| End | time runs out or `end(scores)`; the team with the most points wins, equal points give a draw between those teams |
| Lost players | `lost(key)` / `returned(key)`: the place is kept 30 s, then a bot takes over; the player gets the motorcycle back on return |
| Reset | `reset()`: back to the lobby, bots leave, humans keep their places |

For the other parts of M1: `canMove` is false in the countdown, `clockRunning` is false in a
pause (penalties, obstacles and NPC cars stop then), `tick()` returns the events of the tick
for the game log.

Open points for the team:

- M1-1 (game loop, world state types) is not on `main` yet. `Match` keeps its own roster type;
  it moves into the world state when M1-1 lands. The `package.json` here is a minimal one so
  M1-2 can be tested alone; M1-1 may replace it.
- Player numbers: M2-1 gives each phone its number in the `welcome`, and the join passes it to
  `Match.join`, so the phone and M1 always mean the same player. M1 numbers only the bots.
- The document does not say what happens to a player who leaves in the lobby. Here the place
  stays until reset and the 30 s wait starts with the countdown.

## Team

Tuğberk Akbulut, Abdullatif Yılmaz, Berk Andaçgil, Selim Barut, Umutcan Ocak

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #23
