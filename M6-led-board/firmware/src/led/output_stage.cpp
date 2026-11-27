#include "output_stage.h"

namespace led {

namespace {
// Below this the picture stutters (doc 10.5 asks for 60). The first second does not count.
constexpr uint16_t kLowFps = 50;
}  // namespace

OutputStage::OutputStage(StripOutput& out, const PowerModel& model) : out_(out), post_(model) {}

bool OutputStage::begin() {
  driverOk_ = out_.begin();
  return driverOk_;
}

void OutputStage::setPattern(Pattern p, uint32_t nowMs, uint8_t arg) {
  pattern_ = p;
  patternArg_ = arg;
  patternStart_ = nowMs;
}

PostResult OutputStage::send(const Frame& mixed, uint32_t nowMs) {
  const Frame* in = &mixed;
  if (pattern_ != Pattern::None) {
    drawPattern(patternFrame_, pattern_, nowMs - patternStart_, patternArg_);
    in = &patternFrame_;
  }
  const PostResult r = post_.process(in->data(), sent_.data(), kLedCount);
  const Rgb* chains[mapdata::kChainCount];
  uint16_t counts[mapdata::kChainCount];
  for (uint8_t c = 0; c < mapdata::kChainCount; c++) {
    chains[c] = sent_.data() + chainStart(c);
    counts[c] = mapdata::kChainLeds[c];
  }
  if (driverOk_) out_.show(chains, counts, mapdata::kChainCount);
  stats_.frame(nowMs, r.maEst, r.limited);
  return r;
}

std::vector<std::string> OutputStage::errors(uint32_t nowMs) {
  stats_.tick(nowMs);
  std::vector<std::string> err;
  if (!driverOk_) err.push_back("led_driver");
  if (stats_.fps() > 0 && stats_.fps() < kLowFps) err.push_back("led_fps_low");
  if (pattern_ != Pattern::None) err.push_back("led_test_pattern");
  return err;
}

}  // namespace led
