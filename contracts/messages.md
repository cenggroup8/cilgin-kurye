# Message formats (draft)

Draft collected from the module documents. Module numbers follow the six module
list of v2.0. Other modules add their messages here. JSON examples show the structure; units are metres, seconds
and degrees.

## Player control (phone or bot → server)

Same message for humans and bots, so M1 and M3 treat both the same way.

```json
{ "player": 2, "seq": 912, "throttle": 1, "brake": 0, "steer": 0 }
```

- `throttle`, `brake`: 0 to 1 (phone buttons send 0 or 1)
- `steer`: −1 (left) to 1 (right)
- There is no deliver button: a package is delivered when the player stops inside the delivery area

## Traffic tick input (M1 → M3 traffic part)

```json
{
  "tick": 1824, "t": 60.80, "dt": 0.0333,
  "obstacles_version": 7,
  "obstacles": [ { "id": 3, "segment": 12, "type": "road_work" } ],
  "players": [
    { "id": 2, "team": 1, "bot": true, "x": 212.4, "z": 98.1, "heading_deg": 87.5,
      "speed_mps": 11.2, "phase": "to_delivery", "fallen": false,
      "target": { "x": 350.0, "z": 152.0, "radius_m": 6 } }
  ],
  "events": [ { "type": "npc_hit", "npc": 17, "player": 5 } ]
}
```

Obstacle types: `heavy_traffic`, `road_work`, `accident`, `puddle`.

## Traffic tick output (M3 traffic part → M1)

```json
{
  "tick": 1824,
  "npc": [ { "id": 17, "x": 405.1, "z": 296.0, "heading_deg": 0.0, "speed_mps": 0.0,
             "segment": 51, "lane": 0, "len_m": 4.2, "wid_m": 1.8 } ],
  "bot_controls": [ { "player": 2, "seq": 912, "throttle": 1, "brake": 0, "steer": 0 } ],
  "events": [ { "type": "bot_replanned", "player": 2, "reason": "obstacles_changed" } ]
}
```

## Travel time table (M3 → M1)

```json
{ "team": 1, "obstacles_version": 7, "computed_at_tick": 1790,
  "times_s": { "0": 41.2, "1": 38.7, "17": null } }
```

`null` means the candidate cannot be reached.

## Board protocol (server ↔ board)

MessagePack, protocol version 1. Messages that must arrive (config, vibrate, earthquake
events, status) go on TCP. The board state, sensor samples and delay probes go on UDP.
Server port 47100, board port 47101.
Full examples with exact bytes: `board_protocol_vectors.json`.
Field meanings: M6 module document, Inputs and outputs.
