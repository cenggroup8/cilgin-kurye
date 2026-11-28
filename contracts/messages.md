# Phone and admin messages

The messages between the phone page (M4), the admin page (M5) and the server (M2).
Written by M2-2 (#35) from plan #24 section 3.3, the M1 module chapter of v2.1 and the
drafts that are already in the open pull requests: M2-1 (#58), M2-3 (#84), M1-5
(`M1-game-server/src/admin/admin.ts`), M4-2 (#72) and M5-1 (#73).

The board messages are in `board_protocol.md`. The fields of the game state come from
M1-1 (#78) and are not repeated here.

## Rules for every message

- One WebSocket message is one MessagePack map. `/ws` is for phones, `/ws/admin` for the admin.
- Every map has `t`, the type of the message, as a short string. A map without `t` or with
  an unknown `t` gets `error` with `bad_message` or `unknown_type`.
- Field names are short and in `snake_case`. Units are metres, seconds and degrees, as in
  `README.md`; a time in milliseconds ends in `_ms` or is named in the table.
- A number field must be a finite number. An integer field must be a whole number.
  A value outside its range is not cut to the range: the whole message is refused with
  `out_of_range`, and nothing of it reaches M1.
- A field that is not in the tables below is ignored. A missing optional field is
  written as "optional".
- For development the server can also take the same maps as JSON text (see "Readable form").

## Phone → server

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `key` string 1–64, `name` string (cut to 24 characters), `code` string of 6 digits | Must be the first message. `key` is the random player key that the browser keeps |
| `join` | `team` integer 0–3 | The team chosen in the lobby. It can be sent again to change the team in the lobby |
| `control` | `seq` integer ≥ 1, `throttle` 0–1, `brake` 0–1, `steer` −1–1, `player` integer 0–7 (optional) | Sent on every change and at least 10 times per second. `seq` grows by one for every control |
| `find_me` | none | The "Find me" button. An event, not a value |
| `pong` | `id` integer ≥ 1, `ct` number, `fps` 0–1000, `last` integer ≥ −1 | Answer to `ping`: phone time in ms, frame rate, `seq` of the last state the phone got (−1 for none) |

**Control.** The phone never sends a position, a speed or a score. `player` may be left
out; if it is there, it must be the player number of this link, or the message gets
`not_your_player`. The server always uses the player number of the link, never the one in
the message. A control whose `seq` is not bigger than the last one of this link is old or
repeated and is dropped without an answer. A new link (after a reload) starts again from
the first `seq` it sends.

## Server → phone

| `t` | Fields | Meaning |
|---|---|---|
| `welcome` | `player` integer 0–7, `returning` boolean | The hello was accepted. `returning` is true when the key came back to its place |
| `joined` | `player` integer 0–7, `team` integer 0–3, `color` string | The join was accepted. `color` is the team colour of `README.md`. Sent after M1 accepts the team, and again right after `welcome` when a returning player already has a team. A refused join gets `error` with `bad_join` |
| `error` | `reason` string, `ref` string (optional) | A refused message. `ref` is the `t` of the refused message when it is known |
| `state` | `seq` integer, `s` map | The frozen game state of tick `seq`, 30 times per second. `s` is M1's game state (#78). Every phone gets the same bytes |
| `ping` | `id` integer ≥ 1, `st` number | Twice per second. `st` is the server time in ms |
| `net` | `fps_limit` integer 0–120 | Frame rate limit of this player (admin parameter `net.<p>.fps_limit`). Sent only to the phone of that player (by M2-3): when the admin changes the value, and when the player joins or comes back. 0 means no limit |

## Admin → server

| `t` | Fields | Meaning |
|---|---|---|
| `snapshot_get` | none | Sent after every (re)connect. Answered with one `snapshot` |
| `params_get` | none | Answered with `params` |
| `log_get` | `since` number (optional) | Answered with `log`: the events of the game log after `since` (server time in ms) |
| `cmd` | `id` integer ≥ 0, `name` string, `args` map (optional) | An admin command. Every `cmd` gets exactly one `reply` with the same `id` |

Commands (`name` and `args`), checked again by M1-5:

| `name` | `args` |
|---|---|
| `start`, `pause`, `resume`, `end`, `reset`, `new_code`, `param_reset` | none |
| `param_set` | `name` string, `value` number |
| `obstacle_add` | `type` one of `heavy_traffic`, `road_work`, `accident`, `puddle`; `segment` integer 0–59; `lane` integer 0–4; `pos` 0–1 |
| `obstacle_remove` | `id` integer ≥ 0 |
| `road_close` | `segment` integer 0–59 |
| `obstacle_ahead` | `player` integer 0–7; `type` as above |
| `quake` | `mag` 0–10; `zone` integer −1–8 (−1 is the whole board) |

M2 checks the shape and the ranges of this table. Whether a command is allowed in the
current phase, and whether a parameter name and its value are right, is decided by M1-5;
its answer comes back as `reply`.

## Server → admin

| `t` | Fields | Meaning |
|---|---|---|
| `snapshot` | `state`, `params`, `metrics`, `board`, `events`, `marks` (optional) | Everything after a (re)connect, with about two minutes of history. `marks` is a list of `{time, name}`: the commands accepted in that time, at server time in ms, with the parameter's name for `param_set` and the command's name otherwise, so the graphs draw their change marks again after a page reload |
| `state` | `state` map | Smaller game state, 10 times per second (shape: `AdminState` in M5-1 #73) |
| `params` | `list` array of parameters | Every parameter: `name`, `group`, `label`, `value`, `min`, `max`, `integer`, `owner` (M1-5) |
| `param` | `name` string, `value` number | A value changed. The admin puts a change mark on every graph |
| `metrics` | `samples` array of `{name, time, value}` | Twice per second. `time` in ms |
| `board` | `board` map: `connected` boolean, `samples` array, `quake` `{mag, zone, source}` (optional) | Board link state, sensor samples and the current earthquake. `quake` is missing when no earthquake is going on (it is dropped when the earthquake ends). `source` (optional) says where it came from: `hand` (a hit on the board, `src: hit` in `board_protocol.md`), `motors` (`src: motor`) or `admin` (the earthquake button). Sensor samples of the seismic graph are named `board.accel_g`, one sample per value of `N` with its own time |
| `event` | `entry` `{time, message}` | One line for the event log |
| `log` | `entries` array of `{time, message}` | Answer to `log_get` |
| `reply` | `id` integer, `ok` boolean, `error` string (when `ok` is false) | Answer to one `cmd`. `error` is one of the command errors below |
| `error` | `reason` string, `ref` string (optional) | A refused admin message that is not a `cmd` with a usable `id` |

## Error reasons

| `reason` | When |
|---|---|
| `bad_message` | Not MessagePack (or not JSON in readable form), not a map, or no `t` |
| `unknown_type` | `t` is not a message of this link (a phone message on the admin link counts too) |
| `bad_field` | A field is missing or has the wrong type |
| `out_of_range` | A value is outside its range |
| `not_your_player` | A control names another player |
| `too_big` | The message is bigger than the size limit of the link |
| `too_many` | The link sent more than its limit per second. Sent at most once per second |
| `unexpected` | A message that is not allowed now, for example a second `hello` |
| `bad_hello`, `bad_code`, `full` | The hello was refused; the link is then closed with code 4003 (M2-1) |
| `bad_join` | The join was refused |

**Command errors** (`reply.error`). A `cmd` gets the same names whether M2 or M1-5 refuses it,
so the admin page sees one name for one problem:

| `error` | From | When |
|---|---|---|
| `unknown_command` | M2 or M1-5 | `name` is not a command of the table above |
| `bad_args` | M2 or M1-5 | An argument is missing, has the wrong type or is outside its range |
| `wrong_phase` | M1-5 | The command is not allowed in this phase of the game |
| `owner_not_connected` | M1-5 | The module that owns the parameter is not connected; nothing was changed |
| other names | M1-5 and the part it calls | For example `unknown_param`, `bad_value` and `out_of_range` of the parameter registry for `param_set`, or `no_players` and `cannot_pause` of M1-2. The admin page shows the name as it is |

## Limits for each link

| Link | Largest message | Messages per second | Bytes per second |
|---|---|---|---|
| Phone | 1 KiB | 60 | 16 KiB |
| Admin | 16 KiB | 50 | 128 KiB |

A message over a limit is dropped before it is decoded, so it never reaches M1. The
WebSocket server also closes a link whose single message is bigger than 64 KiB.
A phone sends about 10 to 30 controls and 2 pongs per second, so 60 leaves room for
fast button presses.

## Which messages may be lost

For tests the admin can add loss to each link (M2-4 network emulator). Loss is used only
on `state` (server → phone) and `control` (phone → server). Every other message,
for example `hello`, `join`, `joined`, `find_me` and every admin message, is never dropped.
The codec puts this mark on every checked message (`droppable`).

## Readable form

When the server is started with `M2_READABLE=1`, a link may send JSON text instead of
MessagePack, with the same maps. The server then answers this link in JSON text too.
The game state for all phones stays MessagePack. Use it only for development and tests.
