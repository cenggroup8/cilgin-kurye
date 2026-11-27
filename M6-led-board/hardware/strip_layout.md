# Strip layout of the LED board (draft)

Which LED strip piece lies on which road, in which direction, and in which order the
pieces are joined. Part of M6-5 (#56), plan #28 section 3.4 ("Şerit sırası"). It is the
input of the LED map of M6-3 (`make_led_map`).

| File | What |
|---|---|
| `strip_layout.json` | Every piece: chain, first LED index, road segment, direction, and for every LED its place `t` on the segment, its board position `u, v` and its position in mm |
| `strip_layout.svg` | The same as a drawing of the 60 × 60 cm base at 1:1 (in mm). Printed at 100 % it is also a template for marking the roads on the plywood |
| `tools/strip_layout/gen-strip-layout.mjs` | Makes both files from `contracts/city_plan.json`. `--check` checks the JSON |

Pin numbers and the power drawing come in a separate document (pin table and power).
Only the number of data lines (two, below) is shared with it.

## Numbers

| | Value | Why |
|---|---|---|
| Base | 600 × 600 mm | doc 10.1 |
| Outer roads from the edge | 20 mm | room for the strip and the wires at the edge |
| Road pitch (centre to centre) | 112 mm | (600 − 2 × 20) / 5 |
| Strip | WS2812B, **144 LEDs/m** (6.9 mm from LED to LED), **15 mm** wide | the strip that was bought (two 5 m reels, 720 LEDs each), measured: 14 LEDs in 10 cm |
| LEDs on each road segment | **12** (one piece of 83.3 mm) | the most that leaves at least 27 mm free at each crossing |
| Free space at a crossing | 28.7 mm | the other strip (15 mm) and about 7 mm on each side for the solder pads and the jumper wires; no LEDs in crossings (doc 10.5) |
| Store LEDs | **a piece of 2 LEDs** per store | #20 counts 8 store LEDs; the free store corner of the city plan (30 m × 30 m) is about 22 mm on the board, a piece of 2 (13.9 × 15 mm) fits there |
| All LEDs | **728** = 60 × 12 + 4 × 2 | 5.1 m of strip; 10 m were bought, so there is enough to spare |

With 13 LEDs per segment only about 3 mm would stay free next to each crossing, so 12 is
the proposal. The LED map does not care: it reads the count from `strip_layout.json`.

## Two chains

![Strip layout](strip_layout.svg)

- **Chain A** joins the 30 east-west roads (`h_r_c`) like a snake: row 0 to the east,
  row 1 to the west, and so on. The four stores are in this chain, where the snake
  passes their corner: NW at the start, NE after row 0, SE before row 5, SW at the end.
  368 LEDs.
- **Chain B** joins the 30 north-south roads (`v_r_c`) the same way: column 0 to the
  south, column 1 to the north, and so on. 360 LEDs.

Why two: each chain has a short jumper wire across one crossing between two pieces,
or one road pitch long at the end of a row or column. With one chain for all LEDs a
jumper would have to cross the whole board. Time matters too: one WS2812B LED takes
30 µs, so one chain of 728 LEDs would need about 22 ms for a frame, too slow for the
60 frames per second of doc 10.5 (16.7 ms). With two chains each needs about 11 ms, and
the ESP32 sends both at the same time (two RMT channels), so a frame fits. Each chain
starts in the north-west corner, near each other, so the two data wires from the ESP32
under the base come up through one hole.

## Order of the pieces

"LEDs" is the index in the chain. The first LED of a piece is the one where the data
comes in (DIN); on the strip the small arrows must point in the direction in the last column.

**Chain A**: east-west roads h_r_c and the four stores, 368 LEDs.

| LEDs | Piece | Data runs |
|---|---|---|
| 0–1 | store 0 (NW, blue), piece of 2 LEDs | — |
| 2–13 | `h_0_0` (segment 0) | to the east |
| 14–25 | `h_0_1` (segment 1) | to the east |
| 26–37 | `h_0_2` (segment 2) | to the east |
| 38–49 | `h_0_3` (segment 3) | to the east |
| 50–61 | `h_0_4` (segment 4) | to the east |
| 62–63 | store 1 (NE, green), piece of 2 LEDs | — |
| 64–75 | `h_1_4` (segment 9) | to the west |
| 76–87 | `h_1_3` (segment 8) | to the west |
| 88–99 | `h_1_2` (segment 7) | to the west |
| 100–111 | `h_1_1` (segment 6) | to the west |
| 112–123 | `h_1_0` (segment 5) | to the west |
| 124–135 | `h_2_0` (segment 10) | to the east |
| 136–147 | `h_2_1` (segment 11) | to the east |
| 148–159 | `h_2_2` (segment 12) | to the east |
| 160–171 | `h_2_3` (segment 13) | to the east |
| 172–183 | `h_2_4` (segment 14) | to the east |
| 184–195 | `h_3_4` (segment 19) | to the west |
| 196–207 | `h_3_3` (segment 18) | to the west |
| 208–219 | `h_3_2` (segment 17) | to the west |
| 220–231 | `h_3_1` (segment 16) | to the west |
| 232–243 | `h_3_0` (segment 15) | to the west |
| 244–255 | `h_4_0` (segment 20) | to the east |
| 256–267 | `h_4_1` (segment 21) | to the east |
| 268–279 | `h_4_2` (segment 22) | to the east |
| 280–291 | `h_4_3` (segment 23) | to the east |
| 292–303 | `h_4_4` (segment 24) | to the east |
| 304–305 | store 3 (SE, yellow), piece of 2 LEDs | — |
| 306–317 | `h_5_4` (segment 29) | to the west |
| 318–329 | `h_5_3` (segment 28) | to the west |
| 330–341 | `h_5_2` (segment 27) | to the west |
| 342–353 | `h_5_1` (segment 26) | to the west |
| 354–365 | `h_5_0` (segment 25) | to the west |
| 366–367 | store 2 (SW, purple), piece of 2 LEDs | — |

**Chain B**: north-south roads v_r_c, 360 LEDs.

| LEDs | Piece | Data runs |
|---|---|---|
| 0–11 | `v_0_0` (segment 30) | to the south |
| 12–23 | `v_1_0` (segment 36) | to the south |
| 24–35 | `v_2_0` (segment 42) | to the south |
| 36–47 | `v_3_0` (segment 48) | to the south |
| 48–59 | `v_4_0` (segment 54) | to the south |
| 60–71 | `v_4_1` (segment 55) | to the north |
| 72–83 | `v_3_1` (segment 49) | to the north |
| 84–95 | `v_2_1` (segment 43) | to the north |
| 96–107 | `v_1_1` (segment 37) | to the north |
| 108–119 | `v_0_1` (segment 31) | to the north |
| 120–131 | `v_0_2` (segment 32) | to the south |
| 132–143 | `v_1_2` (segment 38) | to the south |
| 144–155 | `v_2_2` (segment 44) | to the south |
| 156–167 | `v_3_2` (segment 50) | to the south |
| 168–179 | `v_4_2` (segment 56) | to the south |
| 180–191 | `v_4_3` (segment 57) | to the north |
| 192–203 | `v_3_3` (segment 51) | to the north |
| 204–215 | `v_2_3` (segment 45) | to the north |
| 216–227 | `v_1_3` (segment 39) | to the north |
| 228–239 | `v_0_3` (segment 33) | to the north |
| 240–251 | `v_0_4` (segment 34) | to the south |
| 252–263 | `v_1_4` (segment 40) | to the south |
| 264–275 | `v_2_4` (segment 46) | to the south |
| 276–287 | `v_3_4` (segment 52) | to the south |
| 288–299 | `v_4_4` (segment 58) | to the south |
| 300–311 | `v_4_5` (segment 59) | to the north |
| 312–323 | `v_3_5` (segment 53) | to the north |
| 324–335 | `v_2_5` (segment 47) | to the north |
| 336–347 | `v_1_5` (segment 41) | to the north |
| 348–359 | `v_0_5` (segment 35) | to the north |

## Wiring rules

- Every jumper wire has three lines: 5 V, data (DOUT of one piece to DIN of the next)
  and ground. The wire goes across a crossing, next to the strip of the other road, not
  over its LEDs.
- The strip arrows show the data direction. A piece put the wrong way stops the whole
  rest of the chain, so check the arrow against the drawing before gluing.
- Each data line gets a resistor (330 Ω) at the start of the chain, near the level shifter.
- **Power goes in at several places.** A 144 LEDs/m strip has thin copper, so the voltage
  drops fast along it. Feed 5 V and ground from the main wires under the base at the start
  of each chain and again about every two rows or columns (about 1 m of strip), not only
  through the thin jumper wires. The exact feed points and wire sizes come with the power
  drawing.
- 728 LEDs at full white would need about 44 A. The power limit in the config (`max_ma`)
  keeps the real current far below that; the board never shows full white on all LEDs.
- Mark the segment name (`h_2_3`, `v_0_1`) on the base next to each piece. The
  board test pattern of M6-3 lights the pieces one by one in this order, so a wrong
  piece is found at once.

## For the LED map (M6-3)

Read `strip_layout.json`:

- `chains[i].pieces[j].leds[k]` is LED `first + k` of chain `i`.
- For a road piece, `segment` and `t` give the place on the road (`t` from node `a` to
  node `b`, as in `contracts/`), so a motorcycle at `u, v` can be put on the nearest LED.
- `u, v` of every LED is also there, for the shock wave and the countdown.
- `dir` says whether the LED index grows from `a` to `b` or the other way.
- The two chains should be sent at the same time (two RMT channels), see "Two chains".

## Change it

Change the numbers at the top of `tools/strip_layout/gen-strip-layout.mjs`, then:

```
node tools/strip_layout/gen-strip-layout.mjs          # writes the JSON and the drawing
node tools/strip_layout/gen-strip-layout.mjs --check  # checks the JSON
```

The check makes sure that every one of the 60 segments has exactly one piece, the LED
indices of each chain go up without a gap, no LED is in a crossing, the LEDs of a piece
follow its direction, and all four stores are there.

## Open points

- **Power supply.** No 5 V supply for the LEDs was in the order. One with at least 10 A
  is needed (see the power drawing).
- **2 store LEDs.** #20 says 8 store LEDs in all; the issue text says "four store LEDs".
  A piece of two per store is what fits next to the free store corner.
- **Data pins.** Two data lines need two ESP32 pins and two channels of the level
  shifter. They come in the pin table.
- **Board edge.** 20 mm from the edge is a proposal; if the base gets a frame, change
  `MARGIN_MM`.
