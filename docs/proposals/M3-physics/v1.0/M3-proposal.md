# Çılgın Kurye — Module M3: Physics and Collision

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Abdullatif Yılmaz, Hasan Alperen Elmas, Batuhan Yanar, Selim Barut

The PDF next to this file has the same text with all figures.

## 1. Purpose

M3 moves the motorcycles. It turns throttle, brake and steering into speed, direction and position. It finds collisions, decides when a motorcycle falls, and adds the effect of obstacles and earthquakes to the motion. The same code runs in two places: on the server, where its result is the real one, and on the phone, where it guesses the player's own motorcycle before the server answers.

| Runs on | Main computer inside the game server; phone browser for prediction only |
|---|---|
| Technology | TypeScript library; our own simple 2D arcade physics, no ready physics engine; circle and box collisions on a uniform grid; seeded random numbers |
| Requirements | R3 R4 R6 R7 R11 |

*Figure: Where M3 sits in the system. M1 calls M3 in every tick; M5 uses a copy of M3 on the phone.*

## 2. Requirements covered

| **ID** | **Requirement** | **What M3 does for it** |
|---|---|---|
| R3 | Driving and controls | Throttle, brake, left and right; no reverse; U-turn by steering in about a 3 m circle at low speed |
| R4 | Collisions and falls | Collisions with buildings, barriers, NPC cars and motorcycles; a fast hit makes the motorcycle fall |
| R6 | Obstacles | Road work and accidents are solid; an accident has a slow zone; a puddle makes the motorcycle slide |
| R7 | Earthquake | Side push and less grip inside the earthquake radius that M1 sends |
| R11 | Single authority | The code gives the same result for the same input; the server result always wins; the phone only predicts |

## 3. Inputs and outputs

| **Dir.** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | City plan | Shared file | Roads, lanes, blocks and buildings as fixed colliders |
| In | Controls | M1 | Every tick: throttle, brake, steer of humans and bots; a speed factor for each player |
| In | Obstacles, NPC cars | M1, cars from M4 | Obstacle type, road, lane, position; boxes of the NPC cars |
| In | Earthquake | M1 | Centre, strength, radius; the players M1 decided to drop |
| In | Parameters | M6, through M1 | Physics group: top speed, grip, fall speeds, puddle and earthquake effects |
| Out | Poses | M1 | Position, direction, speed, lean, sliding, fallen |
| Out | Events | M1 and M4 | Collisions (with what, how fast) and falls |
| Out | Predicted pose | M5 | The player's own motorcycle before the server answers |

## 4. Main components

| **Component** | **What it does** | **Related modules** |
|---|---|---|
| Motorcycle model | Speed, steering, turning, grip and sliding | — |
| Colliders | Buildings and the outer wall from the city plan; obstacles as boxes, slow zones and slippery areas | M1 |
| Collision solver and fall judge | Solves contacts in a fixed order and decides falls from the hit speed | M1, M4 |
| Earthquake effect | Push and less grip inside the radius | M1 |
| Predictor | Prediction and correction on the phone | M5 |

## 5. How it works

**One physics step.** The server runs 30 ticks per second, and M3 runs 2 sub-steps in each tick, so one sub-step is about 16 ms. Small steps keep fast motorcycles from passing through thin walls. Each sub-step does five things in a fixed order, as the figure shows. A fixed order and seeded random numbers mean that the same inputs always give the same result on the server and on the phone.

*Figure: The five parts of one physics sub-step.*

**Driving.** The throttle adds speed up to the top speed, and the brake and air drag take speed away. There is no reverse. The steering changes the direction. At low speed the motorcycle can turn in a circle of about 3 metres, so a U-turn is easy. At high speed the turn is wider. The model also gives a lean angle, which M5 uses to tilt the 3D motorcycle in a turn.

**Grip and sliding.** In a turn the motorcycle needs a side force. M3 compares the size of this force with the grip limit. If the force is below the limit, the motorcycle follows the turn. If it is above the limit, the motorcycle slides out of the turn. We compare only the size, so a left turn and a right turn act the same. On a water puddle the grip limit is very low, so the motorcycle slides but does not slow down. Inside an earthquake radius the grip is lower too, and there is a small push to the side.

*Figure: Three cases of grip, seen from above. Green is the wanted path; red is the real path.*

**Collisions and falls.** Buildings, the outer wall and the road-work barriers come from the city plan and the obstacle list as boxes. NPC cars are boxes, and motorcycles are circles. To find collisions fast, M3 puts every object into a uniform grid, so it checks only objects in the same or next cell. A contact pushes the objects apart. If the hit speed is above the fall speed that the admin set, the motorcycle falls. When two motorcycles hit each other and their relative speed is above the limit, both of them fall. A fallen motorcycle is not solid, so it does not block the road for others. M1 gives the penalty time and later asks M3 to stand the motorcycle up again. An accident is solid in one lane and has a slow zone around it.

**Prediction on the phone.** On the phone, the player must see the own motorcycle move at once, not 100 ms later. So M5 runs a copy of M3 for this one motorcycle. Each control gets a number and is kept in a list. When a server state arrives, the phone takes the real position from the server, throws away the controls that the server has already used, and runs the remaining controls again. If the new result is close to what the player sees, the difference is blended away in a short time. If it is far, for example after a crash, the motorcycle jumps to the right place.

*Figure: Prediction and correction for the player's own motorcycle.*

## 6. Testing and demonstration

M3 needs no other module. A test makes a world from the city plan and gives scripted controls. We test a straight run and braking, a U-turn, slides to the left and to the right, wall and car crashes, the earthquake radius, the same result for the same inputs, and prediction with delay and loss. In the demonstration one motorcycle drives in the city with the keyboard. The admin changes grip and top speed, and we see the motorcycle change at once.
