# Board protocol (draft)

The messages between the server (M2) and the LED board (M6), protocol version 1.
This file gives the meaning of every field. The exact bytes of one example of each
message are in `board_protocol_vectors.json`. Both sides must encode and decode
every example in the same way.

Every rule below has a source:

- **doc**: written in Modules and Requirements v2.1 (the section is given).
- **vectors**: follows from the examples in `board_protocol_vectors.json`.
- **proposal**: not written anywhere yet. M2 and M6 must approve it.

## 1. Channels

| Rule | Source |
| --- | --- |
| The board keeps one TCP channel and one UDP stream to the server | doc 6.5, 10.5 |
| Messages that must arrive go on TCP: config, vibrate, earthquake events, status | doc 6.5 |
| Data that comes again and again goes on UDP: board state, sensor samples, delay probes and their replies | doc 6.5 |
| All messages are MessagePack maps with string keys. Floats are float32 | vectors |
| A receiver accepts a whole number (integer) wherever a float is expected, because a sender may write 1.0 as 1 | proposal |
| A receiver accepts the fields of a map in any order. A sender writes them in the order of the vectors, so the bytes match | proposal |
| Small TCP messages are sent at once, without waiting to fill a bigger packet | doc 6.5 |
| Port numbers are settings of the server and the board. They are not fixed in this file | proposal |

## 2. Message frame

Every message is one map with the same outer fields.

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `t` | text, 1 letter | Message type (table in section 3) | vectors |
| `v` | integer | Protocol version, now 1. A message with another version is dropped | vectors, doc 10.4 |
| `seq` | integer | Order number (section 5) | vectors, doc 6.5 |
| `ts` | integer | Clock of the sender in milliseconds. Server: server time. Board: time since the board started | proposal |
| `ack` | true | Only on messages that ask for an answer (section 3) | vectors |
| `sid` | integer | Session number of the server (section 6). Only on messages from the server | doc 6.5, name and place are a proposal |
| `d` | map | Content of the message (section 4) | vectors |

**TCP framing.** TCP is a stream of bytes, so each message starts with its length
(doc 6.5). Proposal: the length is 2 bytes, unsigned, high byte first, and counts
only the MessagePack bytes after it. On UDP one packet holds exactly one message
and has no length in front.

## 3. Message types

| `t` | Name | Direction | Channel | `ack` | Source |
| --- | --- | --- | --- | --- | --- |
| `S` | Board state | server → board | UDP | no | doc 10.3 |
| `C` | Config | server → board | TCP | yes | doc 10.3 |
| `V` | Vibrate | server → board | TCP | yes | doc 10.3 |
| `P` | Delay probe | server → board | UDP | no | doc 10.3 |
| `O` | Delay reply | board → server | UDP | no | doc 10.3 |
| `H` | Hello | board → server | UDP for the search, then TCP (section 7) | no | vectors, proposal |
| `Q` | Earthquake event | board → server | TCP | yes | doc 10.3 |
| `N` | Sensor samples | board → server | UDP | no | doc 10.3 |
| `T` | Status | board → server | TCP | no | doc 10.3 |
| `A` | Answer to an `ack` message | both | TCP | no | vectors |

A message with `ack` is answered with an `A` message that has the same `seq`
and the type of that message in `d.of` (vectors: the earthquake event and its
answer both have `seq` 77, and the answer has `of: "Q"`). The answer means
"I used this message". `of` is needed because each type counts by itself, so a
config and a vibrate command can have the same `seq`. Proposal: if no answer comes in 1 s on an open TCP
channel, the sender sends the message again with the same `seq`, and the receiver
answers again but does not use it twice.

## 4. Content of each message

Positions on the board are `u` and `v` from 0 to 1 (`contracts/README.md`,
Coordinates): `u` grows to the east, `v` grows to the south.

### `S` Board state

| Field | Meaning | Source |
| --- | --- | --- |
| `ph` | Game phase: 0 lobby, 1 countdown, 2 game, 3 pause, 4 end | doc 5.5, numbers are a proposal |
| `tl` | Time left in seconds | vectors |
| `p` | Players, one list for each player | doc 10.3 |
| `dp` | Delivery points, one list for each point | doc 10.3 |
| `ob` | Obstacles, one list for each obstacle | doc 10.3 |
| `eq` | Earthquake, one list. Proposal: an empty list when there is no earthquake | doc 10.3 |

The four fields below are lists in a fixed order, to keep the message small.

`p` — one player:

| Place | Value | Meaning |
| --- | --- | --- |
| 0 | integer 0–7 | Player number |
| 1 | integer 0–3 | Team |
| 2 | 0 or 1 | Tone: 0 light, 1 dark |
| 3 | integer | Flags (table below) |
| 4 | float 0–1 | `u` |
| 5 | float 0–1 | `v` |
| 6 | number 0–359 | Heading in degrees, clockwise from north |
| 7 | float | Speed in m/s |

Flags of a player, as bits:

| Bit | Value | Meaning |
| --- | --- | --- |
| 0 | 1 | In the game |
| 1 | 2 | Fallen |
| 2 | 4 | Carries a package |
| 3 | 8 | Bot |
| 4 | 16 | "Find me" is on (the dot is white) |

`dp` — one delivery point:

| Place | Value | Meaning |
| --- | --- | --- |
| 0 | integer 0–7 | Player that owns the point |
| 1 | float 0–1 | `u` |
| 2 | float 0–1 | `v` |
| 3 | 0 or 1 | 0 waiting (blinks), 1 delivered just now (flash) |

`ob` — one obstacle:

| Place | Value | Meaning |
| --- | --- | --- |
| 0 | integer 0–59 | Road segment (`contracts/README.md`, ID rules) |
| 1 | integer 1–4 | Type: 1 `heavy_traffic`, 2 `road_work`, 3 `accident`, 4 `puddle` (the names M1 uses in the admin commands) |
| 2 | integer 0–4 | Lane. 0 means the whole road; 1–4 as in `contracts/README.md` (Lanes) |

The board shows an obstacle on the whole road segment (doc 10.2), so the position
on the segment is not sent to the board.

`eq` — the earthquake:

| Place | Value | Meaning |
| --- | --- | --- |
| 0 | 0 or 1 | 1 while the earthquake is on |
| 1 | float 0–1 | `u` of the centre |
| 2 | float 0–1 | `v` of the centre |
| 3 | number 0–10 | Strength |
| 4 | integer | Milliseconds since the earthquake started (for the shock wave) |

Source of the four lists: the order follows the example in the vectors (player 2:
team 1, bot, at x 212.4 m and z 98.1 m, road work on segment 12). The meaning of
each place is a **proposal** until M1, M2 and M6 approve it.

### `C` Config

| Field | Meaning | Source |
| --- | --- | --- |
| `plan` | Version of the city plan that the server uses. The board compares it with its own | vectors |
| `bright` | Brightness from 0.1 to 1 | doc 10.3 |
| `max_ma` | Power limit of the LEDs in mA | doc 10.3 |
| `tones` | The 8 player colours as red, green, blue (0–255). Place = 2 × team + tone | doc 10.3, order is a proposal |
| `anim.tail` | Length of the tail of a motorcycle dot, in LEDs | proposal |
| `anim.dp_blink_hz` | How fast a delivery point blinks | proposal |

### `V` Vibrate

| Field | Meaning | Source |
| --- | --- | --- |
| `mask` | Motors to use, as bits: bit 0 zone 0, bit 1 zone 2, bit 2 zone 6, bit 3 zone 8 | doc 10.5, bit order is a proposal |
| `duty` | Strength from 0 to 1 | doc 10.3 |
| `ms` | Duration in milliseconds | doc 10.3 |
| `ramp_ms` | Time of the soft start in milliseconds | doc 10.3 |

### `P` Delay probe and `O` Delay reply

The probe has no content. Its `ts` is the server time. The board answers at once
(doc 10.3).

| Field of `O` | Meaning | Source |
| --- | --- | --- |
| `seq` (frame) | The same `seq` as the probe | vectors |
| `ping_ts` | The `ts` of the probe | vectors |
| `state_seq` | `seq` of the last board state that the board used | vectors |
| `state_age_ms` | How old that state was when the reply was sent | vectors |

### `H` Hello

| Field | Meaning | Source |
| --- | --- | --- |
| `fw` | Version of the board program | vectors |
| `plan` | Version of the city plan in the board | vectors |
| `board` | Name of the board | vectors |

### `Q` Earthquake event

| Field | Meaning | Source |
| --- | --- | --- |
| `id` | Number of the event, counted by the board | vectors |
| `src` | `"hit"` for a hand hit, `"motor"` for the vibration motors | doc 10.3, the text `"motor"` is a proposal |
| `peak_g` | Strongest shaking that was measured, in g | vectors |
| `mag` | Strength from 0 to 10 | doc 10.3 |
| `u`, `v` | Place of the hit as the board measured it. M1 does not use it for the game: it uses the centre of `zone` (doc 5.5) | doc 10.3 |
| `zone` | Zone 0–8 in a 3 × 3 grid: `zone = 3 × row + column`, row 0 in the north, column 0 in the west | doc 10.3, numbering follows the vectors |
| `conf` | Confidence from 0 to 1 | doc 10.3 |

### `N` Sensor samples

| Field | Meaning | Source |
| --- | --- | --- |
| `hz` | Samples per second | vectors |
| `a` | A small group of samples: the size of the shaking in g, oldest first | doc 10.3, unit is a proposal |

### `T` Status

Sent once per second (doc 10.3).

| Field | Meaning | Source |
| --- | --- | --- |
| `fw`, `plan` | As in Hello | vectors |
| `last_seq` | `seq` of the last board state that the board used | vectors |
| `fps` | LED frames per second | doc 10.3 |
| `rssi` | Wi-Fi signal in dBm | doc 10.3 |
| `ma_est` | Power estimate of the LEDs in mA | doc 10.3 |
| `heap` | Free memory in bytes | vectors |
| `err` | List of error names. Empty when all is well | doc 10.3 |

### `A` Answer

The `seq` is the `seq` of the message that it answers.

| Field | Meaning | Source |
| --- | --- | --- |
| `of` | Type of the message that it answers, for example `"V"` | vectors, proposal |

## 5. Order numbers

| Rule | Source |
| --- | --- |
| Every message has an order number | doc 6.5 |
| Each side counts each message type by itself (in the vectors the state has 52031 and the config has 4) | vectors |
| `O` and `A` do not count. They copy the `seq` of the message that they answer | vectors |
| On UDP a message is dropped when its `seq` is not higher than the last `seq` of the same type | doc 6.5 |
| On the board UDP stream, gaps in the order numbers give the real packet loss | doc 6.5 |

## 6. Session number

Each start of the server makes a new session number. When the board sees a new
session number, it starts its order numbers again, so new messages are not dropped
as old ones (doc 6.5).

Proposal:

- The server picks a random session number from 1 to 4294967295 when it starts
  and puts it as `sid` into the frame of every message that it sends to the board
  (in the vectors: `S`, `C`, `V`, `P` and the `A` that answers an earthquake event).
- When the board sees a `sid` that is different from the last one, it forgets the
  last `seq` of every message type.
- The other direction needs no session number: when the server gets a Hello, it
  forgets the last `seq` of every message type from the board.

## 7. Finding the server and connecting

The board first looks for the server on the local network. If it finds nothing,
it uses a backup server address from its flash memory (doc 6.5).

Proposal:

1. The board sends a Hello as a UDP broadcast on the local network once per second.
2. The server answers with a delay probe to the address of the board.
3. The board now knows the server address and opens the TCP channel.
4. The board sends a Hello on TCP. The server sends the config.
5. The server starts the board state and the delay probes on UDP. The board starts
   the status on TCP.
6. If no answer comes to the broadcast for 5 s, the board tries the backup address
   in the same way from step 3.

## 8. Lost link

| Rule | Source |
| --- | --- |
| If no board state comes for a short time, the board stops the motors at once and goes to "searching" | doc 10.5 |
| Proposal: the "short time" is 1 s | proposal |
| The board then starts again from section 7 | doc 10.5 |
| The server marks the board as lost when no status and no delay reply comes for 3 s | proposal |

## 9. Rates

| Message | Rate | Source |
| --- | --- | --- |
| Board state | 10 to 30 per second, set by the admin | doc 6.5, 10.3 |
| Status | 1 per second | doc 10.3 |
| Delay probe | 2 per second | proposal |
| Sensor samples | 10 messages per second, 10 samples in each | proposal, follows the vectors |
