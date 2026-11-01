// M8 LED animation engine - skeleton. Layers, effects and the LED map come next
// (M8 proposal, Section 7). Until then render() draws only the link status.
#include "led_engine.h"

namespace m8 {
namespace {
BoardConfig gConfig;
BoardState gState;
LinkStatus gLink = LinkStatus::Searching;
}  // namespace

void applyConfig(const BoardConfig& cfg) { gConfig = cfg; }
void applyState(const BoardState& st) { gState = st; }
void setLinkStatus(LinkStatus s) { gLink = s; }

void render(uint32_t nowMs, Rgb* out) {
  for (int i = 0; i < kLedCount; ++i) out[i] = {0, 0, 0};
  // Store LEDs (last 8) breathe amber while the server link is not connected.
  if (gLink != LinkStatus::Connected) {
    uint32_t phase = nowMs % 2000;
    uint8_t level = phase < 1000 ? phase * 120 / 1000 : (2000 - phase) * 120 / 1000;
    for (int i = kLedCount - 8; i < kLedCount; ++i) out[i] = {level, static_cast<uint8_t>(level / 2), 0};
  }
}

uint32_t estimateMilliamps(const Rgb* frame, int count) {
  uint32_t sum = 0;
  for (int i = 0; i < count; ++i) sum += frame[i].r + frame[i].g + frame[i].b;
  return sum * 20 / 255 + static_cast<uint32_t>(count);  // 20 mA per full channel + 1 mA idle per LED
}

}  // namespace m8
