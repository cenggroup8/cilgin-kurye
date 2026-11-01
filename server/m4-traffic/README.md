# M4 Traffic and AI

Road graph and shortest paths, travel-time table for delivery selection, NPC traffic (IDM), AI bot drivers.

Members: Hasan Alperen Elmas, Batuhan Yanar, Muhib Taha Boy

## Interface (see the M4 module proposal, Section 3)

```
init(cityPlan, params, seed)
setParams(partialParams)
tick(TickInput) -> TickOutput        // every server tick
getTravelTimes(teamId) -> TravelTimeTable
getRoute(fromPos, toPos) -> Route
getMetrics() -> TrafficMetrics
```

Message examples: `contracts/messages.md`.

## Planned layout

```
m4-traffic/
├── src/        graph, routes, npc, bots, metrics
├── test/       unit and property tests (T1-T10)
├── mocks/      mock physics (M3), mock game (M1), scripted players
└── debug/      top-down 2D debug view
```
