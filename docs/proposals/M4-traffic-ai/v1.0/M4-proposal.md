# Çılgın Kurye — Module M4: Traffic and AI

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Hasan Alperen Elmas, Batuhan Yanar, Muhib Taha Boy

The PDF next to this file has the same text with all figures.

## 1. Purpose

M4 brings the city to life. It finds routes and travel times on the road network. It moves the NPC cars that make the traffic. It also drives the AI bots that fill the empty places in a game. A bot makes the same control message that a phone sends, so for M1 a bot and a human player look the same.

| Runs on | Main computer inside the game server; M1 runs it once in every tick |
|---|---|
| Technology | TypeScript; our own shortest-path search (Dijkstra); a car-following model for NPC cars; a state machine and path following for bots; seeded random numbers |
| Requirements | R1 R2 R4 R6 R11 |

*Figure: Where M4 sits in the system. M4 talks only to M1, inside the same program.*

## 2. Requirements covered

| **ID** | **Requirement** | **What M4 does for it** |
|---|---|---|
| R1 | Multiplayer game | Bots take the empty places and play like players |
| R2 | Delivery cycle | Travel-time table from each store, which M1 uses for fair near and far points |
| R4 | Traffic | NPC cars make real traffic on the roads |
| R6 | Obstacles | Heavy traffic adds slow cars; an accident closes a lane; road work closes the road for routes and cars |
| R11 | Independent development | Talks only to M1 with plain data; tested with its own test program |

## 3. Inputs and outputs

| **Dir.** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | City plan | Shared file | Intersections, roads, lanes, stores, possible delivery points |
| In | Game data | M1 | Every tick: players, obstacles with a version number, car-hit events |
| In | Parameters | M6, through M1 | Number of NPC cars, traffic effects, bot skill |
| Out | NPC cars | M1, then M3, M5, M6 | Position, direction, speed, lane, size |
| Out | Bot controls | M1, then M3 | The same record as a phone: throttle, brake, steer, deliver |
| Out | Travel times | M1 | Seconds from each team store to every possible delivery point |
| Out | Traffic metrics | M1, then M6 | Number of NPC cars, mean NPC speed, bot route changes |

## 4. Main components

| **Component** | **What it does** | **Related modules** |
|---|---|---|
| Road graph | 36 intersections and 60 two-way roads with lanes and turn costs | — |
| Route planner | Fastest routes and the travel-time table; computed again only when the obstacles change | M1 |
| NPC traffic | Moves, adds and removes NPC cars | M1, M3 |
| Bot drivers | One state machine for each bot | M1, M3 |
| Traffic metrics | Values for the admin graphs | M6 |

## 5. How it works

**The road graph and routes.** The city has 6 roads in each direction. Where two roads cross, there is an intersection, so the graph has 36 intersections. Between them there are 60 road segments, and cars can drive both ways. Each segment has a cost: the expected time to drive it. Turning left or making a U-turn adds a small extra cost. Obstacles change the costs. Heavy traffic and an accident make a segment slower, and road work closes it. M4 uses Dijkstra's shortest-path search to find the fastest routes. The graph is small, so one search takes much less than a millisecond. M4 computes the routes again only when the version number of the obstacle list changes. From the results it makes the travel-time table: the time from each of the four stores to every possible delivery point. M1 uses this table to choose fair near and far points.

*Figure: A route on the road graph, drawn on the board. Obstacles change the cost of the roads.*

**NPC traffic.** Each NPC car follows a lane and picks a new turn at each intersection. A car keeps a safe gap behind the car or the motorcycle in front of it. If the gap gets small, it slows down smoothly, and it speeds up again when the road is free. A car enters an intersection only when the intersection is free, so cars do not drive through each other. New cars never appear close to a player. If a car is stuck for 10 seconds, M4 removes it and adds it again somewhere else, so the traffic never locks up. The admin sets the number of cars, and heavy-traffic obstacles add extra slow cars on their road.

*Figure: How NPC cars drive: a safe gap behind the next vehicle, and a free crossing before they enter.*

**Bots.** Every bot has a small state machine that follows the delivery cycle, as the figure below shows. The bot drives to the store, gets the package, drives to the delivery point, slows down and presses “Deliver”, and then goes back. On the way it follows the route from the planner. It steers toward a point a little ahead on the path, so the motion looks smooth. If it falls, it waits for the penalty time. If it is stuck, it asks for a new route. One “bot skill” value sets the top speed, the reaction time and some steering noise, so the admin can make bots weaker or stronger.

*Figure: The state machine of one bot.*

## 6. Testing and demonstration

A small test program plays the role of M1 and draws the city from above. We test routes with and without closed roads, equal travel times for all teams in a city that is the same on all sides, 80 cars for 30 minutes without a traffic lock, obstacles that change during play, 8 bots that finish deliveries, and the same result with the same seed. In the demonstration the admin adds obstacles and more traffic, and the cars and bots change their way at once.
