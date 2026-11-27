#include "test_pattern.h"

#include <cstring>

namespace led {

namespace {

constexpr Rgb kOff{0, 0, 0};
constexpr Rgb kRed{255, 0, 0};
constexpr Rgb kGreen{0, 255, 0};
constexpr Rgb kWhite{255, 255, 255};

constexpr uint8_t kMaxPieces = 80;

struct Pieces {
  Piece list[kMaxPieces];
  uint8_t count = 0;
};

const Pieces& pieces() {
  static const Pieces p = [] {
    Pieces out;
    uint16_t i = 0;
    while (i < kLedCount && out.count < kMaxPieces) {
      const mapdata::LedRow& start = mapdata::kLeds[i];
      uint16_t j = i + 1;
      while (j < kLedCount && mapdata::kLeds[j].chain == start.chain && mapdata::kLeds[j].segment == start.segment &&
             mapdata::kLeds[j].store == start.store) {
        j++;
      }
      out.list[out.count++] = Piece{i, static_cast<uint8_t>(j - i), start.segment, start.store};
      i = j;
    }
    return out;
  }();
  return p;
}

}  // namespace

bool patternFromName(const char* name, Pattern& out) {
  static const struct {
    const char* name;
    Pattern p;
  } kNames[] = {{"off", Pattern::None}, {"pieces", Pattern::Pieces}, {"chase", Pattern::Chase},
                {"segment", Pattern::Segment}, {"white", Pattern::White}};
  for (const auto& n : kNames) {
    if (std::strcmp(n.name, name) == 0) {
      out = n.p;
      return true;
    }
  }
  return false;
}

const char* patternName(Pattern p) {
  switch (p) {
    case Pattern::Pieces: return "pieces";
    case Pattern::Chase: return "chase";
    case Pattern::Segment: return "segment";
    case Pattern::White: return "white";
    default: return "off";
  }
}

uint8_t pieceCount() { return pieces().count; }

Piece piece(uint8_t i) { return i < pieces().count ? pieces().list[i] : Piece{0, 0, -1, -1}; }

void drawPattern(Frame& f, Pattern p, uint32_t ms, uint8_t arg) {
  f.fill(kOff);
  switch (p) {
    case Pattern::Pieces: {
      const Piece pc = piece(static_cast<uint8_t>((ms / 1000) % pieceCount()));
      for (uint8_t k = 0; k < pc.count; k++) f[pc.first + k] = k == 0 ? kRed : kGreen;
      break;
    }
    case Pattern::Chase: {
      for (uint8_t c = 0; c < mapdata::kChainCount; c++) {
        const uint16_t n = mapdata::kChainLeds[c];
        f[chainStart(c) + (ms * 30 / 1000) % n] = kWhite;
      }
      break;
    }
    case Pattern::Segment: {
      if (arg >= mapdata::kSegmentCount) break;
      const mapdata::SegmentRow& s = mapdata::kSegments[arg];
      for (uint8_t k = 0; k < s.count; k++) {
        // Red at node a, blue at node b, whatever way the strip was wired.
        const uint8_t t = mapdata::kLeds[s.first + k].t;
        f[s.first + k] = Rgb{static_cast<uint8_t>(255 - t), 0, t};
      }
      break;
    }
    case Pattern::White:
      f.fill(kWhite);
      break;
    case Pattern::None:
      break;
  }
}

}  // namespace led
