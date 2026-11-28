// Test patterns of the board (M6-3): check that every LED lies where the map says.
// Selected over the USB cable (`test <name>`), drawn instead of the game.
//
//   pieces   the pieces light one after the other in chain order, one per second.
//            The piece is green, its first LED (where the data comes in, DIN) is red,
//            so a piece put the wrong way round shows at once (strip_layout.md).
//   chase    one white LED runs along each chain, 30 LEDs per second: a gap or a jump
//            means a broken joint.
//   segment  one road segment, chosen by number, with its LEDs from node a (red) to node b
//            (blue): checks the direction of the map, not of the wiring.
//   white    all LEDs white. The power limit keeps the current under max_ma; this is the
//            pattern for the current measurement of #54.
#pragma once
#include <cstdint>

#include "led_map.h"

namespace led {

enum class Pattern : uint8_t { None, Pieces, Chase, Segment, White };

/** Name over the USB cable, for example "pieces". Returns false for an unknown name. */
bool patternFromName(const char* name, Pattern& out);
const char* patternName(Pattern p);

/** A piece of strip as it is wired: `count` LEDs from `first` (index in a Frame). */
struct Piece {
  uint16_t first;
  uint8_t count;
  int8_t segment;  // -1 for a store
  int8_t store;    // -1 for a road
};

/** The pieces in chain order (60 roads and 4 stores in the strip layout). */
uint8_t pieceCount();
Piece piece(uint8_t i);

/** Draws a pattern at time `ms` since it started. `arg` is the segment of `Segment`. */
void drawPattern(Frame& f, Pattern p, uint32_t ms, uint8_t arg = 0);

}  // namespace led
