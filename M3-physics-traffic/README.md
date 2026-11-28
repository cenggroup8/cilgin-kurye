# M3 Physics, Traffic and AI

M3 moves everything on the roads. It has two parts. The physics part turns throttle, brake and steering into speed, direction and position. It finds collisions, decides when a motorcycle falls, and adds the effect of obstacles and earthquakes to the motion. The traffic part finds routes and travel times on the road network, moves the NPC cars that make the traffic, and drives the AI bots that fill the empty places in a game. A bot makes the same control record that a phone sends, so for M1 a bot and a human player look the same. The physics code also runs on the phone, where it guesses the player's own motorcycle before the server answers.

| Runs on | Technology | Requirements |
|---|---|---|
| Main computer inside the game server, called by M1 in every tick. The physics part also runs in the phone browser for prediction | TypeScript, a 3D physics engine that runs on the web, our own shortest path search (Dijkstra), a car following model for NPC cars, a state machine and path following for bots, seeded random numbers | R1 R2 R3 R4 R6 R7 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | City plan | Shared file | Roads, lanes, intersections, blocks, buildings, stores and possible delivery points |
| In | Controls | M1 | Every tick: throttle and brake from 0 to 1, steer from −1 to 1, for humans and bots, and a speed factor for each player |
| In | Game data | M1 | Players, obstacles with type, road, lane and position, the earthquake area and the motorcycles that fall |
| In | Parameters | M5, through M1 | Top speed, grip, fall speed, grip in a puddle and in an earthquake, number of NPC cars, traffic effects, bot skill |
| Out | Poses | M1 | Position, direction, speed, lean, sliding, fallen |
| Out | Events | M1 | Collisions (with what and how fast) and falls |
| Out | NPC cars | M1, then M4, M5 | Position, direction, speed, lane, size |
| Out | Bot controls | M1 | The same record as a phone: throttle, brake, steer |
| Out | Travel times | M1 | Seconds from each team store to every possible delivery point |
| Out | Traffic metrics | M1, then M5 | Number of NPC cars, mean NPC speed, bot route changes |
| Out | Predicted pose | M4 | The player's own motorcycle before the server answers |

## Planned layout

```
src/
  physics/
    bike/        M3-1  motorcycle model
    predictor/   M3-1  prediction on the phone
    collide/     M3-2  colliders, collision solver, fall judge, earthquake effect
  traffic/
    graph/       M3-3  road graph
    routes/      M3-3  route planner, travel time table
    npc/         M3-4  NPC traffic, traffic metrics
    bots/        M3-5  bot drivers
test/
  fakes/         M3-1  fake M1
debug/           M3-1  test page with keyboard driving
```

Shared by all M3 packages:

```
src/
  common/
    rng.ts       seeded random numbers (never use Math.random in M3)
    types.ts     game data from M1: players, obstacles, world coordinates
    coords.ts    the one place that converts contracts/ coordinates (x east, z south, degrees)
                 and M3 coordinates (x east, y north, radians)
  traffic/graph/
    types.ts     RoadGraph interface (M3-3 builds the real graph)
    laneGeometry.ts  lane positions and turn kinds
test/fakes/
  fakeRoadGraph.ts   6 x 6 grid city, 36 intersections, 60 roads
```

Each part can be built and tested alone with test data, as the module document describes.

## Running

The tools are the same as in M1 and M2: TypeScript 7, Vitest 5, `NodeNext`. So relative
imports end in `.js` (`from './types.js'`), also in the files that run in the browser.

```
npm install
npm test            # all tests
npm run typecheck
npm run demo:npc    # two minutes of NPC traffic with fake data, prints metrics and a map
```

## NPC traffic (M3-4)

`src/traffic/npc/` — M1 calls `NpcTraffic.step()` once per tick, before the physics part.

- In: `dt`, players, obstacles, car hits from physics, changed admin parameters (`TrafficInput`).
- Out: NPC car poses (`NpcCarPose`) and traffic metrics (`TrafficMetrics`).
- Car following: Intelligent Driver Model (`idm.ts`).
- Intersections: each box has four quarter cells; a car enters only after it locks all cells
  of its path and its exit lane has room (`intersections.ts`).
- The car count moves to the admin value a few cars per tick; new cars never appear near a player;
  stuck cars are removed and added again elsewhere; heavy traffic adds slow cars on its road.

**Pause and new game.** While the game is paused M1 does not call `step()`, so nothing moves and
no timer runs. For a new game M1 calls `reset(seed)` (or makes a new `NpcTraffic`): all cars and
counters go, the admin parameters stay. Extra heavy traffic cars belong to an obstacle id, so an
old instance must not be used for a new game without `reset`.

**Border to M1** (`contract.ts`, in the language of `contracts/`):

```ts
const traffic = new NpcTraffic(graph, { seed });
// every tick, before physics:
const { cars, metrics } = traffic.step({
  dt,                                                  // s, must be > 0; cut to 0.1
  players,                                             // M3 coordinates
  obstacles: fromContractObstacles(m1.obstacles.items, graph), // type 'heavy_traffic', segment, lane 0-4, pos 0-1
  carHits,                                             // from the physics step before
  params: trafficParamChanges(changedAdminValues),     // registry names, see below
});
const forM4andM5 = cars.map((c) => toContractCar(c, graph)); // x, z, heading in degrees, segment, lane 1-4
```

Bad input (unknown segment, lane, type, `dt` <= 0, a parameter out of range) throws `RangeError`.
M1 checks these values before, so an error means a bug.

**Admin parameters** owned by M3-4 (`params.ts`; limits are a proposal for M1's `param-list.ts`):

| Name | Range | Start | Traffic parameter |
|---|---|---|---|
| `physics.npc_count` | 0–60 | 20 | `carCount` |
| `physics.npc_speed_mps` | 5–20 | 11 | `maxSpeed` |
| `physics.npc_hit_stop_s` | 0–10 | 2.5 | `hitStopTime` |
| `obstacles.heavy_traffic.effect` | 0–1 | 0.5 | extra cars `round(8 × effect)`, speed factor `1 − 0.8 × effect` |

The other values in `DEFAULT_TRAFFIC_PARAMS` stay at their start values.

## Team

Abdullatif Yılmaz, Hasan Alperen Elmas, Batuhan Yanar, Selim Barut, Muhib Taha Boy

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #25

## Bots (M3-5)

`src/traffic/bots/` drives the AI bots. `BotFleet` owns the route planner (M3-3) and the bots;
M1 calls `fleet.update(obstacles, roadSpeeds)` when the obstacles change and
`bot.tick({ pose, carrying, delivery, neighbours }, dt)` every tick. The answer is the same
`control` record a phone sends (`seq`, `throttle`, `brake`, `steer`).

- State machine: `toStore` → `pickup` (stands still at the store) → `toDelivery` → `deliver`
  (stands still at the point, M1 delivers) → `toStore` again.
- Path following: looks at a point on the lane a little ahead (further when faster), slows
  before corners and before the goal, keeps a gap to cars in front.
- Fallen: sends empty controls and goes on in the same state when M1 lifts it.
- Stuck (standing still before the goal for 2.5 s): asks for a new route; the second time it
  turns round and leaves the road.
- New obstacle list: every bot gets a new route when the planner says routes changed.
- Skill 0–1 (`skillFromLevel`): top speed 7–16 m/s, reaction 0.6–0.05 s, steer noise 0.25–0.01.
- Metric: `bot.routeChanges`, `fleet.routeChanges()`.

`npm run demo:bots [city_plan.json]` runs it with a fake M1 and no server. Tests use a small
kinematic motorcycle (`test/traffic/bots/helpers.ts`) until M3-1 is merged.
