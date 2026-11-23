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

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Abdullatif Yılmaz, Hasan Alperen Elmas, Batuhan Yanar, Selim Barut, Muhib Taha Boy

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #25
