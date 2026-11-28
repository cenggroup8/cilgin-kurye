// PC tests for the LED output part (M6-3): LED map, test patterns, post processing,
// power limit, frame report and settings. Run: make test
#include <cmath>
#include <cstdio>
#include <set>
#include <string>
#include <vector>

#include "../../src/led/led_map.h"
#include "../../src/led/output_stage.h"
#include "../../src/led/post_process.h"
#include "../../src/led/test_pattern.h"
#include "../../src/sys/frame_stats.h"
#include "../../src/sys/settings.h"

using namespace led;

static int checks = 0, failed = 0;
#define CHECK(cond, what)                                                      \
  do {                                                                         \
    ++checks;                                                                  \
    if (!(cond)) {                                                             \
      ++failed;                                                                \
      std::printf("  FAIL %s:%d: %s  %s\n", __FILE__, __LINE__, #cond, what); \
    }                                                                          \
  } while (0)

static void section(const char* name) { std::printf("- %s\n", name); }

/** Keeps what the strips would get. */
class FakeOutput : public StripOutput {
 public:
  bool ok = true;
  int frames = 0;
  std::vector<std::vector<Rgb>> chains;
  bool begin() override { return ok; }
  void show(const Rgb* const* c, const uint16_t* counts, uint8_t n) override {
    frames++;
    chains.assign(n, {});
    for (uint8_t i = 0; i < n; i++) chains[i].assign(c[i], c[i] + counts[i]);
  }
};

static bool same(Rgb a, Rgb b) { return a.r == b.r && a.g == b.g && a.b == b.b; }

// --- LED map ----------------------------------------------------------------------

static void testMap() {
  section("LED map: every LED once, every road and store, the chains in order");
  CHECK(kLedCount == 788, "788 LEDs (strip_layout.md: 65 cm board, 12 mm strip)");
  CHECK(mapdata::kChainLeds[0] == 398 && mapdata::kChainLeds[1] == 390, "chain A 398, chain B 390");
  CHECK(chainStart(0) == 0 && chainStart(1) == 398, "chain B starts after chain A");
  int roads = 0, stores = 0;
  for (uint16_t i = 0; i < kLedCount; i++) {
    const auto& l = mapdata::kLeds[i];
    CHECK(l.index == i - chainStart(l.chain), "LED index follows the chain");
    if (l.segment >= 0) roads++;
    if (l.store >= 0) stores++;
    CHECK((l.segment >= 0) != (l.store >= 0), "an LED is on a road or in a store");
  }
  CHECK(roads == 780 && stores == 8, "60 × 13 road LEDs, 4 × 2 store LEDs");
  for (uint8_t s = 0; s < 60; s++) {
    const auto& seg = mapdata::kSegments[s];
    CHECK(seg.count == 13, "13 LEDs per road");
    for (uint8_t k = 0; k < seg.count; k++) CHECK(ledSegment(seg.first + k) == s, "segment table points to its LEDs");
    // East-west roads (0–29) are in chain A, north-south roads (30–59) in chain B.
    CHECK(mapdata::kLeds[seg.first].chain == (s < 30 ? 0 : 1), "road in the right chain");
  }
  for (uint8_t team = 0; team < 4; team++) {
    uint16_t leds[4];
    CHECK(storeLeds(team, leds, 4) == 2, "2 LEDs in each store");
  }
}

static void testLookups() {
  section("LED map: place on a road and nearest LED to a board place");
  // t = 0.5 on any road is the middle LED of its 13, never at a crossing.
  for (uint8_t s = 0; s < 60; s++) {
    const uint16_t led = ledOnSegment(s, 0.5f);
    CHECK(led != kNoLed && ledSegment(led) == s, "LED on the asked road");
    const float t = mapdata::kLeds[led].t / 255.0f;
    CHECK(std::fabs(t - 0.5f) < 0.05f, "middle of the road");
    // Node a end and node b end, whatever way the piece was wired.
    const float ta = mapdata::kLeds[ledOnSegment(s, 0.0f)].t / 255.0f;
    const float tb = mapdata::kLeds[ledOnSegment(s, 1.0f)].t / 255.0f;
    CHECK(ta < 0.2f && tb > 0.8f, "ends of the road");
  }
  CHECK(ledOnSegment(60, 0.5f) == kNoLed && ledOnSegment(3, 1.5f) == kNoLed, "bad segment or t gives no LED");
  // The nearest road LED to the middle of segment h_0_0 (u ≈ 0.1, v = 0) is on that road.
  const uint16_t n = nearestRoadLed(0.1f, 0.0f);
  CHECK(n != kNoLed && ledSegment(n) == 0, "nearest LED of a place on h_0_0");
  for (uint16_t i = 0; i < kLedCount; i += 37) {
    if (ledSegment(i) < 0) continue;
    CHECK(nearestRoadLed(ledU(i), ledV(i)) == i, "an LED is the nearest to its own place");
  }
  CHECK(nearestRoadLed(5.0f, 0.5f) == kNoLed, "a place far off the board gives no LED");
}

// --- test patterns ------------------------------------------------------------------

static void testPatterns() {
  section("Test patterns: pieces one by one with the data end in red, chase, segment, white");
  CHECK(pieceCount() == 64, "60 road pieces and 4 store pieces");
  Frame f;
  std::set<uint16_t> lit;
  for (uint8_t i = 0; i < pieceCount(); i++) {
    drawPattern(f, Pattern::Pieces, i * 1000u + 500u);
    const Piece p = piece(i);
    int on = 0;
    for (uint16_t k = 0; k < kLedCount; k++) {
      if (f[k].r || f[k].g || f[k].b) {
        on++;
        lit.insert(k);
      }
    }
    CHECK(on == p.count, "only this piece is on");
    CHECK(same(f[p.first], Rgb{255, 0, 0}), "the first LED (DIN) is red");
    CHECK(same(f[p.first + p.count - 1], Rgb{0, 255, 0}), "the rest is green");
  }
  CHECK(lit.size() == kLedCount, "in one round every LED was on once");

  drawPattern(f, Pattern::Chase, 1000);  // 30 LEDs per second: LED 30 of each chain
  CHECK(f[30].r == 255 && f[chainStart(1) + 30].r == 255, "chase: one LED per chain");

  const auto& s = mapdata::kSegments[35];  // a north-south road wired from b to a (snake)
  CHECK(s.reversed, "segment 35 is wired from node b to node a");
  drawPattern(f, Pattern::Segment, 0, 35);
  const uint16_t a = ledOnSegment(35, 0.0f), b = ledOnSegment(35, 1.0f);
  CHECK(f[a].r > 200 && f[a].b < 60 && f[b].b > 200 && f[b].r < 60, "red at node a, blue at node b");

  Pattern p;
  CHECK(patternFromName("white", p) && p == Pattern::White, "name to pattern");
  CHECK(!patternFromName("rainbow", p), "unknown name");
}

// --- post processing and power ------------------------------------------------------

static void testPost() {
  section("Post processing: gamma, brightness");
  CHECK(gamma8(0) == 0 && gamma8(255) == 255, "gamma keeps the ends");
  CHECK(gamma8(128) > 50 && gamma8(128) < 60, "gamma 2.2: half input is about a fifth");
  for (int i = 1; i < 256; i++) CHECK(gamma8(i) >= gamma8(i - 1), "gamma never goes down");

  PostProcessor post;
  post.setConfig(0.5f, 60000);
  Frame in, out;
  in.fill(Rgb{255, 128, 0});
  PostResult r = post.process(in.data(), out.data(), kLedCount);
  CHECK(!r.limited, "no limit under 60 A");
  CHECK(out[0].r == 128 && out[0].g == 28 && out[0].b == 0, "gamma then brightness 0.5");
  post.setConfig(0.01f, 8000);
  CHECK(post.bright() == 0.1f, "brightness is at least 0.1");
  post.setConfig(5.0f, 8000);
  CHECK(post.bright() == 1.0f, "brightness is at most 1");
  post.setConfig(std::nanf(""), 8000);
  CHECK(post.bright() == 0.1f, "a broken brightness becomes 0.1");
}

static void testPower() {
  section("Power limit: full white stays under max_ma, the picture keeps its look");
  PostProcessor post;
  Frame white, out;
  white.fill(Rgb{255, 255, 255});
  CHECK(post.estimateMa(white.data(), kLedCount) > 47000, "full white on 788 LEDs is about 47 A");

  for (uint16_t limit : {8000, 4000, 2000, 1000}) {
    post.setConfig(1.0f, limit);
    const PostResult r = post.process(white.data(), out.data(), kLedCount);
    CHECK(r.limited && r.maEst <= limit, "estimate under the limit");
    // One step of the 8-bit values on every channel of every LED is 788 × 3 × 20 / 255 ≈ 186 mA.
    CHECK(r.maEst + 186 > limit, "and at most one step less: the limit only takes what it must");
    CHECK(r.maBefore > 47000, "before the limit about 47 A");
  }

  // A mixed picture is dimmed by one factor: the ratio of two colours stays.
  Frame mixed;
  mixed.fill(Rgb{0, 0, 0});
  for (uint16_t i = 0; i < kLedCount; i += 2) mixed[i] = Rgb{255, 128, 0};
  post.setConfig(1.0f, 3000);
  const PostResult r = post.process(mixed.data(), out.data(), kLedCount);
  CHECK(r.limited && r.maEst <= 3000, "limited");
  const float ratio = static_cast<float>(out[0].g) / out[0].r;
  CHECK(std::fabs(ratio - gamma8(128) / 255.0f) < 0.05f, "red and green keep their ratio");

  post.setConfig(1.0f, 500);  // less than the idle current of 788 LEDs
  const PostResult dark = post.process(white.data(), out.data(), kLedCount);
  CHECK(dark.powerScale == 0.0f && out[100].r == 0, "below the idle current all LEDs are off");
}

// --- output stage and frame report -----------------------------------------------------

static void testOutputStage() {
  section("Output stage: chains to the strips, frame report, test pattern instead of the game");
  FakeOutput fake;
  OutputStage stage(fake);
  CHECK(stage.begin(), "driver starts");
  stage.setConfig(1.0f, 8000);
  Frame game;
  game.fill(Rgb{0, 0, 0});
  game[0] = Rgb{255, 0, 0};    // chain A, LED 0
  game[chainStart(1)] = Rgb{0, 0, 255};  // chain B, LED 0
  uint32_t t = 0;
  for (int i = 0; i < 60 * 3; i++, t += 16) stage.send(game, t);  // 3 s at about 60 frames per second
  CHECK(fake.frames == 180, "every frame went out");
  CHECK(fake.chains.size() == 2 && fake.chains[0].size() == 398 && fake.chains[1].size() == 390, "two chains");
  CHECK(fake.chains[0][0].r == 255 && fake.chains[1][0].b == 255, "each chain starts with its first LED");
  CHECK(stage.fps() >= 60 && stage.fps() <= 64, "about 60 frames per second");
  CHECK(stage.maEst() == kLedCount + 40u, "two LEDs on: idle current (1 mA each) plus 40 mA");
  CHECK(stage.errors(t).empty(), "no error");

  stage.setPattern(Pattern::White, t);
  for (int i = 0; i < 70; i++, t += 16) stage.send(game, t);
  CHECK(fake.chains[0][100].r > 0 && fake.chains[1][100].g > 0, "white pattern instead of the game");
  CHECK(stage.maEst() <= 8000, "white pattern stays under the limit");
  const auto err = stage.errors(t);
  CHECK(err.size() == 1 && err[0] == "led_test_pattern", "the test pattern shows in the status");

  t += 5000;
  CHECK(stage.errors(t).size() == 1 && stage.fps() == 0, "no frames: 0 per second");

  FakeOutput broken;
  broken.ok = false;
  OutputStage stage2(broken);
  CHECK(!stage2.begin(), "driver fails");
  stage2.send(game, 0);
  CHECK(broken.frames == 0, "nothing sent to a broken driver");
  CHECK(stage2.errors(0).at(0) == "led_driver", "and the status says so");
}

static void testFrameStats() {
  section("Frame report: slow frames are reported");
  sys::FrameStats s;
  for (uint32_t t = 0; t <= 2000; t += 40) s.frame(t, 1000, t == 1200);
  CHECK(s.fps() == 25, "25 frames per second");
  CHECK(s.limited(), "the limit in the last second shows");
  s.tick(2500);
  CHECK(s.fps() == 25, "nothing changes inside a second");
}

// --- settings -----------------------------------------------------------------------

static void testSettings() {
  section("Settings: the Wi-Fi name changes over the USB cable, with no new build");
  sys::MemoryStore flash;
  sys::Settings defaults;
  defaults.wifiSsid = "from-secrets";
  defaults.wifiPass = "secret123";
  defaults.backupHost = "192.168.4.2";
  sys::ConsoleAction act;
  {
    sys::SettingsConsole con(flash, defaults);
    CHECK(con.settings().wifiSsid == "from-secrets", "built-in values at first");
    CHECK(con.handle("set wifi_ssid Lab Wi-Fi 2", act).rfind("ok", 0) == 0, "a name with spaces");
    CHECK(con.handle("set wifi_pass short", act).rfind("error", 0) == 0, "a too short password");
    CHECK(con.handle("set wifi_pass abcdefgh", act).rfind("ok", 0) == 0, "an 8 character password");
    CHECK(con.handle("set backup_host 10.0.0.5", act).rfind("ok", 0) == 0, "backup address");
    CHECK(con.handle("set backup_host bad host!", act).rfind("error", 0) == 0, "bad address");
    CHECK(con.handle("set cal.noiseFactor 5.5", act).rfind("ok", 0) == 0, "calibration value of M6-2");
    CHECK(con.handle("set cal.noiseFactor five", act).rfind("error", 0) == 0, "calibration needs a number");
    CHECK(con.handle("set cal.aVeryLongCalibrationName 1", act).rfind("error", 0) == 0, "flash keys are at most 15 characters");
    CHECK(con.dirty() && flash.strings.empty(), "nothing in flash before save");
    const std::string shown = con.handle("show", act);
    CHECK(shown.find("abcdefgh") == std::string::npos && shown.find("********") != std::string::npos, "show hides the password");
    CHECK(con.handle("save", act).rfind("ok", 0) == 0 && !con.dirty(), "saved");
    CHECK(con.handle("restart", act).rfind("ok", 0) == 0 && act.kind == sys::ConsoleAction::Restart, "restart is asked");
  }
  // After a restart the board reads the flash.
  sys::SettingsConsole after(flash, defaults);
  CHECK(after.settings().wifiSsid == "Lab Wi-Fi 2", "new Wi-Fi name after restart");
  CHECK(after.settings().wifiPass == "abcdefgh" && after.settings().backupHost == "10.0.0.5", "password and backup address");
  CHECK(after.settings().cal.at("noiseFactor") == 5.5f, "calibration value");
  float v = 0;
  CHECK(flash.getFloat("noiseFactor", v) && v == 5.5f, "M6-2 reads it with getFloat");

  CHECK(after.handle("test segment 12", act).rfind("ok", 0) == 0 && act.kind == sys::ConsoleAction::TestPattern &&
            act.pattern == "segment" && act.arg == 12, "test pattern command");
  CHECK(after.handle("dance", act).rfind("error", 0) == 0, "unknown command");
  CHECK(after.handle("reset", act).rfind("ok", 0) == 0 && after.settings().wifiSsid == "from-secrets" && flash.strings.empty(),
        "reset goes back to the built-in values");
}

int main() {
  testMap();
  testLookups();
  testPatterns();
  testPost();
  testPower();
  testOutputStage();
  testFrameStats();
  testSettings();
  std::printf("\n%d checks, %d failed\n", checks, failed);
  return failed ? 1 : 0;
}
