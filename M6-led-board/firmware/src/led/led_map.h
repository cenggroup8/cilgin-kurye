// LED map (M6-3, plan #28 section 3.2): which LED lies where on the board.
// The table itself is made from the city plan and the strip layout by
// tools/make_led_map/make-led-map.mjs and goes into the build (led_map_data.h).
// M6-4 draws with these calls; it never needs to know the chains or the wiring.
#pragma once
#include <array>
#include <cstdint>

#include "led_map_data.h"

namespace led {

struct Rgb {
  uint8_t r = 0, g = 0, b = 0;
};

constexpr uint16_t kLedCount = mapdata::kLedCount;
constexpr uint16_t kNoLed = 0xFFFF;

/** One frame: the colour of every LED, chain A first, then chain B (the order of the map). */
using Frame = std::array<Rgb, kLedCount>;

/** First LED of a chain in a Frame. */
uint16_t chainStart(uint8_t chain);

/** The LED of a road segment nearest to place t (0 at node a, 1 at node b), or kNoLed. */
uint16_t ledOnSegment(uint8_t segment, float t);

/** The road LED nearest to a board place (u east, v south, 0–1), or kNoLed. */
uint16_t nearestRoadLed(float u, float v);

/** The LEDs of a team store (two in the strip layout). Returns how many were written. */
uint8_t storeLeds(uint8_t team, uint16_t* out, uint8_t max);

/** Board place of an LED. */
float ledU(uint16_t led);
float ledV(uint16_t led);

/** Road segment of an LED, or -1 for a store LED. */
int8_t ledSegment(uint16_t led);

}  // namespace led
