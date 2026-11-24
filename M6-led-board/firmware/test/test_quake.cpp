// M6-2 tests on the PC. Build and run: make test   (in firmware/test)
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>

#include "../src/quake/calibration.h"
#include "../src/quake/fixed_rate.h"
#include "../src/quake/hit_detector.h"
#include "../src/quake/motor_controller.h"
#include "../src/quake/quake_unit.h"
#include "../src/quake/sample_batcher.h"
#include "sim_board.h"

using namespace quake;

static int g_failed = 0, g_checks = 0;
#define CHECK(cond, ...)                                     \
  do {                                                       \
    g_checks++;                                              \
    if (!(cond)) {                                           \
      g_failed++;                                            \
      std::printf("  FAIL %s:%d: %s  ", __FILE__, __LINE__, #cond); \
      std::printf(__VA_ARGS__);                              \
      std::printf("\n");                                     \
    }                                                        \
  } while (0)

static void title(const char* t) { std::printf("- %s\n", t); }

// Runs the board for `seconds` and collects the events.
static std::vector<QuakeEvent> run(sim::Board& b, HitDetector& d, float seconds, float hz = 200.0f) {
  std::vector<QuakeEvent> out;
  int n = int(seconds * hz);
  for (int i = 0; i < n; i++) {
    QuakeEvent e;
    if (d.addSample(b.next(), e)) out.push_back(e);
  }
  return out;
}

static bool nearZone(int a, int b) { return std::abs(a / 3 - b / 3) <= 1 && std::abs(a % 3 - b % 3) <= 1; }

static void testQuietTable() {
  title("quiet table with slow tilting: no event in 10 minutes");
  sim::Board b(1);
  HitDetector d;
  auto ev = run(b, d, 600);
  CHECK(ev.empty(), "%zu events", ev.size());
  CHECK(d.threshold() == d.calibration().floorG, "threshold %.3f", d.threshold());
}

static void testNoisyTable() {
  title("noisy table with normal play: threshold goes up, no event");
  sim::Board b(2);
  b.noiseG = 0.05f;
  b.bumpG = 0.35f;
  HitDetector d;
  auto ev = run(b, d, 600);
  CHECK(ev.empty(), "%zu events, threshold %.3f", ev.size(), d.threshold());
  CHECK(d.threshold() > 0.3f, "threshold %.3f did not go up", d.threshold());
  std::printf("  learned noise %.3f g, threshold %.3f g\n", d.noiseLevel(), d.threshold());

  title("the same noisy table: a real hit is still found");
  b.hit({0.85f, 0.5f, 2.0f});
  auto ev2 = run(b, d, 1.0f);
  CHECK(ev2.size() == 1, "%zu events", ev2.size());
}

static void testNineZones() {
  title("9 zones x 40 hits: every hit is one event, zone right or a neighbour");
  sim::Board b(3);
  HitDetector d;
  run(b, d, 4);  // learn the room
  std::uniform_real_distribution<float> cell(0.08f, 0.92f), strength(0.8f, 6.0f);
  int confusion[9][9] = {};
  int total = 0, found = 0, exact = 0, nearOk = 0, extra = 0;
  for (int zone = 0; zone < 9; zone++) {
    for (int k = 0; k < 40; k++) {
      float u = (zone % 3 + cell(b.rng())) / 3.0f;
      float v = (zone / 3 + cell(b.rng())) / 3.0f;
      b.hit({u, v, strength(b.rng())});
      auto ev = run(b, d, 1.0f);
      total++;
      if (ev.empty()) continue;
      found++;
      extra += int(ev.size()) - 1;
      const QuakeEvent& e = ev[0];
      confusion[zone][e.zone]++;
      if (e.zone == zone) exact++;
      if (nearZone(e.zone, zone)) nearOk++;
      CHECK(e.src == Source::Hit, "source");
      CHECK(e.mag >= 0 && e.mag <= 10, "mag %.2f", e.mag);
      CHECK(e.conf >= 0 && e.conf <= 1, "conf %.2f", e.conf);
      CHECK(e.u >= 0 && e.u <= 1 && e.v >= 0 && e.v <= 1, "centre %.2f %.2f", e.u, e.v);
      CHECK(e.zone == std::min(2, int(e.v * 3)) * 3 + std::min(2, int(e.u * 3)), "zone does not match centre");
    }
  }
  CHECK(found == total, "%d of %d hits found", found, total);
  CHECK(extra == 0, "%d extra events", extra);
  CHECK(nearOk == found, "%d of %d zones right or neighbour", nearOk, found);
  std::printf("  found %d/%d, exact zone %d (%.0f%%), right or neighbour %d\n", found, total, exact,
              100.0 * exact / total, nearOk);
  std::printf("  real zone -> found zone\n       ");
  for (int j = 0; j < 9; j++) std::printf("%4d", j);
  std::printf("\n");
  for (int i = 0; i < 9; i++) {
    std::printf("    %d: ", i);
    for (int j = 0; j < 9; j++) std::printf("%4d", confusion[i][j]);
    std::printf("\n");
  }
}

static void testIds() {
  title("event ids count up");
  sim::Board b(4);
  HitDetector d;
  run(b, d, 4);
  std::vector<QuakeEvent> all;
  for (int i = 0; i < 5; i++) {
    b.hit({0.5f, 0.2f, 2.0f});
    auto ev = run(b, d, 1.0f);
    all.insert(all.end(), ev.begin(), ev.end());
  }
  CHECK(all.size() == 5, "%zu", all.size());
  for (size_t i = 0; i < all.size(); i++) CHECK(all[i].id == i + 1, "id %u", all[i].id);
}

static void testStrength() {
  title("strength scale: standard hit 5, slow growth, kept in 0..10");
  HitDetector d;
  CHECK(std::fabs(d.strengthFor(2.0f) - 5.0f) < 1e-4, "%.3f", d.strengthFor(2.0f));
  CHECK(std::fabs(d.strengthFor(4.0f) - 7.0f) < 1e-4, "%.3f", d.strengthFor(4.0f));
  CHECK(std::fabs(d.strengthFor(1.0f) - 3.0f) < 1e-4, "%.3f", d.strengthFor(1.0f));
  CHECK(d.strengthFor(100.0f) == 10.0f, "%.3f", d.strengthFor(100.0f));
  CHECK(d.strengthFor(0.01f) == 0.0f, "%.3f", d.strengthFor(0.01f));
  CHECK(d.strengthFor(0.25f) < d.strengthFor(0.5f) && d.strengthFor(0.5f) < d.strengthFor(1.0f), "order");

  title("strength from simulated hits follows the peak");
  sim::Board b(5);
  HitDetector d2;
  run(b, d2, 4);
  float last = -1;
  for (float p : {0.4f, 1.0f, 2.0f, 4.0f, 8.0f, 30.0f}) {
    b.hit({0.5f, 0.5f, p});
    auto ev = run(b, d2, 1.0f);
    CHECK(ev.size() == 1, "peak %.1f: %zu events", p, ev.size());
    if (ev.empty()) continue;
    std::printf("  peak %5.1f g -> strength %.2f\n", p, ev[0].mag);
    CHECK(ev[0].mag > last, "strength did not grow");
    if (p == 2.0f) CHECK(std::fabs(ev[0].mag - 5.0f) < 0.5f, "standard hit %.2f", ev[0].mag);
    if (p == 30.0f) CHECK(ev[0].mag == 10.0f, "clamp %.2f", ev[0].mag);
    last = ev[0].mag;
  }
}

static void testCentreHit() {
  title("hit in the middle: zone 4");
  sim::Board b(6);
  HitDetector d;
  run(b, d, 4);
  int inCentre = 0;
  for (int i = 0; i < 20; i++) {
    b.hit({0.5f, 0.5f, 2.0f});
    auto ev = run(b, d, 1.0f);
    if (ev.size() == 1 && ev[0].zone == 4) inCentre++;
  }
  CHECK(inCentre >= 18, "%d of 20", inCentre);
}

static void testDoubleHitIsOneEvent() {
  title("two hits 100 ms apart make one event; a hit 1 s later makes a new one");
  sim::Board b(7);
  HitDetector d;
  run(b, d, 4);
  b.hit({0.2f, 0.2f, 2.0f});
  auto ev = run(b, d, 0.1f);
  b.hit({0.2f, 0.2f, 2.0f});
  auto ev2 = run(b, d, 0.9f);
  CHECK(ev.size() + ev2.size() == 1, "%zu", ev.size() + ev2.size());
  b.hit({0.2f, 0.2f, 2.0f});
  auto ev3 = run(b, d, 1.0f);
  CHECK(ev3.size() == 1, "%zu", ev3.size());
}

static void testMotorShaking() {
  title("motor shaking 3 s: one event with source motor, noise not learned");
  sim::Board b(8);
  HitDetector d;
  run(b, d, 5);
  float noiseBefore = d.noiseLevel();
  d.setMotorsRunning(true);
  b.motors(true);
  auto ev = run(b, d, 3.0f);
  b.motors(false);
  d.setMotorsRunning(false);
  CHECK(ev.size() == 1, "%zu events", ev.size());
  if (!ev.empty()) {
    CHECK(ev[0].src == Source::Motor, "source %s", sourceName(ev[0].src));
    std::printf("  motor event: strength %.2f zone %d\n", ev[0].mag, ev[0].zone);
  }
  CHECK(std::fabs(d.noiseLevel() - noiseBefore) < 1e-6, "noise %.4f -> %.4f", noiseBefore, d.noiseLevel());

  title("after the motors stop: no second earthquake, a later hand hit is a hit");
  auto after = run(b, d, 2.0f);
  CHECK(after.empty(), "%zu events after the motors", after.size());
  b.hit({0.8f, 0.8f, 2.0f});
  auto hit = run(b, d, 1.0f);
  CHECK(hit.size() == 1 && hit[0].src == Source::Hit, "%zu", hit.size());
}

static void testMountingFlags() {
  title("mounting flags: a sensor turned around gives the right zone after flipX/flipY");
  sim::Board b(9);
  b.dirErrDeg = 0;
  b.distErr = 0;
  // Sensor turned by 180 degrees: x and y are the other way.
  QuakeCalibration cal;
  cal.flipX = cal.flipY = true;
  HitDetector d(cal);
  run(b, d, 4);
  b.hit({0.15f, 0.15f, 2.0f});  // zone 0 on the board, the turned sensor sees zone 8
  auto ev = run(b, d, 1.0f);
  // The simulator gives board axes, so with the flags on the zone is mirrored.
  CHECK(ev.size() == 1 && ev[0].zone == 8, "zone %d", ev.empty() ? -1 : ev[0].zone);
  cal.flipX = cal.flipY = false;
  cal.swapXY = true;
  HitDetector d2(cal);
  run(b, d2, 4);
  b.hit({0.85f, 0.15f, 2.0f});  // zone 2 -> with x and y swapped it is zone 6
  auto ev2 = run(b, d2, 1.0f);
  CHECK(ev2.size() == 1 && ev2[0].zone == 6, "zone %d", ev2.empty() ? -1 : ev2[0].zone);
}

// ---- calibration storage ----
struct MapStore : SettingsStore {
  std::map<std::string, float> m;
  bool getFloat(const char* k, float& out) const override {
    auto it = m.find(k);
    if (it == m.end()) return false;
    out = it->second;
    return true;
  }
  void putFloat(const char* k, float v) override { m[k] = v; }
};

static void testCalibrationStore() {
  title("calibration values are saved and read back; missing ones keep defaults");
  MapStore st;
  QuakeCalibration c;
  c.standardPeakG = 3.5f;
  c.noiseFactor = 8;
  c.flipY = true;
  saveCalibration(st, c);
  for (auto& kv : st.m) CHECK(kv.first.size() <= 15, "key %s too long", kv.first.c_str());
  CHECK(st.m.size() == 9, "%zu keys", st.m.size());
  QuakeCalibration r = loadCalibration(st);
  CHECK(r.standardPeakG == 3.5f && r.noiseFactor == 8 && r.flipY && !r.flipX, "round trip");
  MapStore partial;
  partial.putFloat("q_floor", 0.3f);
  QuakeCalibration p = loadCalibration(partial);
  CHECK(p.floorG == 0.3f && p.standardPeakG == QuakeCalibration{}.standardPeakG, "partial");
  HitDetector d(r);
  CHECK(std::fabs(d.strengthFor(3.5f) - 5.0f) < 1e-4, "new standard hit is 5");
}

// ---- motors ----
struct FakeMotors : MotorOutput {
  float duty[4] = {0, 0, 0, 0};
  int writes = 0;
  void setDuty(int m, float d) override { duty[m] = d; writes++; }
};

static void testMotorController() {
  title("motors: soft start, then full power, then stop at the end");
  FakeMotors out;
  MotorController mc(out);
  CHECK(mc.start({0x0F, 0.6f, 1000, 200}, 0), "start");
  mc.update(0, true);
  CHECK(out.duty[0] == 0, "starts at 0: %.2f", out.duty[0]);
  mc.update(100, true);
  CHECK(std::fabs(out.duty[0] - 0.3f) < 1e-4, "half way: %.3f", out.duty[0]);
  mc.update(200, true);
  CHECK(std::fabs(out.duty[3] - 0.6f) < 1e-4, "full: %.3f", out.duty[3]);
  float prev = 0;
  bool smooth = true;
  FakeMotors o2;
  MotorController m2(o2);
  m2.start({0x01, 0.8f, 1000, 300}, 0);
  for (uint32_t t = 0; t <= 300; t += 10) {
    m2.update(t, true);
    if (o2.duty[0] - prev > 0.8f * 10 / 300 + 1e-4) smooth = false;
    prev = o2.duty[0];
  }
  CHECK(smooth, "power jumped");
  mc.update(999, true);
  CHECK(mc.running(), "still running");
  mc.update(1000, true);
  CHECK(!mc.running() && out.duty[0] == 0 && out.duty[3] == 0, "stopped at the end");

  title("motors: limits on strength, time and soft start");
  FakeMotors o3;
  MotorController m3(o3);
  m3.start({0x0F, 1.0f, 60000, 0}, 0);
  m3.update(10, true);
  CHECK(o3.duty[0] < 0.8f * 0.1f, "no soft start: %.3f", o3.duty[0]);
  m3.update(1000, true);
  CHECK(o3.duty[0] == m3.limits().maxDuty, "duty limit: %.3f", o3.duty[0]);
  m3.update(m3.limits().maxMs, true);
  CHECK(!m3.running(), "time limit");

  title("motors: only the motors in the mask run");
  FakeMotors o4;
  MotorController m4(o4);
  m4.start({0b0101, 0.5f, 1000, 150}, 0);
  m4.update(500, true);
  CHECK(o4.duty[0] > 0 && o4.duty[2] > 0 && o4.duty[1] == 0 && o4.duty[3] == 0, "mask");
  m4.start({0b0010, 0.5f, 1000, 150}, 600);
  CHECK(o4.duty[0] == 0 && o4.duty[2] == 0, "old motors stop for a new command");
  CHECK(kMotorZone[0] == 0 && kMotorZone[1] == 2 && kMotorZone[2] == 6 && kMotorZone[3] == 8, "corner zones");

  title("motors: link lost -> all stop at once");
  FakeMotors o5;
  MotorController m5(o5);
  m5.start({0x0F, 0.7f, 3000, 150}, 0);
  m5.update(1000, true);
  CHECK(o5.duty[1] > 0, "running");
  m5.update(1001, false);
  CHECK(!m5.running() && o5.duty[0] == 0 && o5.duty[1] == 0 && o5.duty[2] == 0 && o5.duty[3] == 0, "stopped");
  m5.update(1002, true);
  CHECK(o5.duty[0] == 0, "does not start again by itself");

  title("motors: empty command does nothing, timer works over the millis() wrap");
  FakeMotors o6;
  MotorController m6(o6);
  CHECK(!m6.start({0, 0.5f, 1000, 150}, 0) && !m6.running(), "empty mask");
  CHECK(!m6.start({0x0F, 0, 1000, 150}, 0) && !m6.running(), "zero duty");
  m6.start({0x0F, 0.5f, 1000, 150}, 0xFFFFFF00u);
  m6.update(0xFFFFFF00u + 500, true);  // wraps past 0
  CHECK(m6.running() && o6.duty[0] == 0.5f, "over the wrap");
}

static void testBatcher() {
  title("sensor samples: 200 Hz -> 100 Hz groups of 10, a short peak is kept");
  SampleBatcher<10> sb(200, 100);
  int groups = 0;
  float maxSeen = 0;
  for (int i = 0; i < 200; i++) {
    float v = (i == 77) ? 3.0f : 0.01f;  // one single sample peak
    if (sb.add(v)) {
      groups++;
      CHECK(sb.size() == 10, "%zu", sb.size());
      for (size_t k = 0; k < sb.size(); k++) maxSeen = std::max(maxSeen, sb.values()[k]);
      sb.clear();
    }
  }
  CHECK(groups == 10, "%d groups per second", groups);
  CHECK(maxSeen == 3.0f, "peak lost: %.2f", maxSeen);
  CHECK(sb.hz() == 100, "hz");
}

static void testFixedRate() {
  title("fixed rate: 200 Hz exactly on average, with a jittery loop");
  FixedRate fr(200);
  std::mt19937 rng(10);
  std::uniform_int_distribution<int> jit(50, 700);
  uint32_t now = 123;
  int ticks = 0;
  for (; now < 10000000u; now += jit(rng))
    if (fr.due(now)) ticks++;
  CHECK(std::abs(ticks - 2000) <= 1, "%d samples in 10 s", ticks);

  title("fixed rate: over the micros() wrap, and a long stop skips samples");
  FixedRate f2(200);
  uint32_t t = 0xFFFF0000u;
  int n = 0;
  for (int i = 0; i < 100000; i++, t += 100)
    if (f2.due(t)) n++;
  CHECK(std::abs(n - 2000) <= 1, "%d", n);
  FixedRate f3(200);
  f3.due(0);
  CHECK(f3.due(5000), "due");
  CHECK(f3.due(1000000), "after a long stop");
  CHECK(!f3.due(1000001), "no burst after a long stop");
  CHECK(f3.skipped() > 0, "skipped counted");
}

// ---- whole unit in a main loop ----
struct SimSensor : MotionSensor {
  sim::Board& b;
  explicit SimSensor(sim::Board& bb) : b(bb) {}
  bool read(ImuSample& s) override { s = b.next(); return true; }
};
struct Collect {
  std::vector<QuakeEvent> events;
  int groups = 0;
  int values = 0;
};

static void testUnit() {
  title("main loop: sensor at 200 Hz, a hit, the graph groups, the motors and a lost link");
  sim::Board b(11);
  SimSensor sensor(b);
  FakeMotors motors;
  QuakeUnit unit(sensor, motors);
  Collect c;
  unit.onEvent([](const QuakeEvent& e, void* ctx) { static_cast<Collect*>(ctx)->events.push_back(e); }, &c);
  unit.onSamples([](int hz, const float*, int n, void* ctx) {
    auto* cc = static_cast<Collect*>(ctx);
    cc->groups++;
    cc->values += n;
    (void)hz;
  }, &c);
  uint32_t us = 0;
  auto loopFor = [&](float seconds, bool link) {
    uint32_t end = us + uint32_t(seconds * 1e6f);
    for (; us < end; us += 250) unit.loop(us, us / 1000, link);  // loop every 250 us
  };
  loopFor(4, true);
  CHECK(c.groups == 40 && c.values == 400, "groups %d values %d", c.groups, c.values);
  b.hit({0.15f, 0.85f, 2.0f});
  loopFor(1, true);
  CHECK(c.events.size() == 1 && nearZone(c.events[0].zone, 6), "hit: %zu", c.events.size());

  unit.vibrate({0x0F, 0.6f, 2000, 200}, us / 1000);
  b.motors(true);
  loopFor(1, true);
  CHECK(unit.motors().running(), "motors on");
  b.motors(false);  // link lost: the motors stop, so the shaking stops
  loopFor(1.5f, false);
  CHECK(!unit.motors().running() && motors.duty[0] == 0, "stopped on link loss");
  loopFor(2, true);
  int motorEvents = 0, hitEvents = 0;
  for (auto& e : c.events) (e.src == Source::Motor ? motorEvents : hitEvents)++;
  CHECK(motorEvents == 1 && hitEvents == 1, "motor %d hit %d", motorEvents, hitEvents);
}

int main() {
  std::printf("M6-2 hit detector and motor controller tests\n");
  testQuietTable();
  testNoisyTable();
  testNineZones();
  testIds();
  testStrength();
  testCentreHit();
  testDoubleHitIsOneEvent();
  testMotorShaking();
  testMountingFlags();
  testCalibrationStore();
  testMotorController();
  testBatcher();
  testFixedRate();
  testUnit();
  std::printf("\n%d checks, %d failed\n", g_checks, g_failed);
  return g_failed == 0 ? 0 : 1;
}
