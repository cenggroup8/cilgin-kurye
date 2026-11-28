// PC tests for M6-4: road graph, motion smoother, layers and effects, phase views and
// demo mode. Run: make test-m64 (or make test, which runs all LED tests)
#include <cmath>
#include <cstdio>
#include <set>

#include "../../src/led/board_renderer.h"
#include "../../src/led/demo_mode.h"
#include "../../src/led/motion_smoother.h"
#include "../../src/led/road_graph.h"

using namespace led;
using boardlink::BoardConfig;
using boardlink::BoardState;
using boardlink::LinkState;

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
static bool same(Rgb a, Rgb b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
static bool dark(Rgb a) { return a.r + a.g + a.b < 6; }
static const RoadGraph& G() { return RoadGraph::board(); }

/** Distance from a board place to the nearest road centre line. */
static float offRoad(float u, float v) {
  float x, y;
  G().place(G().nearest(u, v), x, y);
  return std::hypot(x - u, y - v);
}

/** A player on the road for the tests. */
static boardlink::Player player(uint8_t id, RoadPos p, float speed, bool towardB) {
  boardlink::Player pl;
  pl.id = id;
  pl.team = id / 2;
  pl.tone = id % 2;
  pl.flags = boardlink::kInGame;
  G().place(p, pl.u, pl.v);
  const RoadSegment& s = G().segment(p.seg);
  float du = G().node(s.b).u - G().node(s.a).u, dv = G().node(s.b).v - G().node(s.a).v;
  if (!towardB) du = -du, dv = -dv;
  float h = std::atan2(du, -dv) * 180.0f / 3.14159265f;
  pl.heading = h < 0 ? h + 360 : h;
  pl.speed = speed;
  return pl;
}

// --- road graph ---------------------------------------------------------------------

static void testGraph() {
  section("road graph from the LED map: 36 intersections, 60 roads of one block");
  CHECK(G().nodeCount() == 36, "6 x 6 grid");
  int corners = 0, edges = 0, inner = 0;
  for (uint8_t n = 0; n < G().nodeCount(); n++) {
    const auto& node = G().node(n);
    if (node.linkCount == 2) corners++;
    if (node.linkCount == 3) edges++;
    if (node.linkCount == 4) inner++;
    CHECK(std::fabs(node.u * 5 - std::round(node.u * 5)) < 0.01f, "node on the 100 m grid (u)");
    CHECK(std::fabs(node.v * 5 - std::round(node.v * 5)) < 0.01f, "node on the 100 m grid (v)");
  }
  CHECK(corners == 4 && edges == 16 && inner == 16, "4 corners, 16 sides, 16 inner crossings");
  for (uint8_t s = 0; s < G().segmentCount(); s++) {
    CHECK(std::fabs(G().segment(s).length - 0.2f) < 0.005f, "every road is one block long");
  }

  section("route: along roads and through intersections, pieces join up");
  const RoadPos a{0, 0.5f};
  const RoadPos b = G().nearest(0.5f, 0.3f);
  RoadGraph::Piece pc[12];
  float len = 0;
  const uint8_t n = G().route(a, b, pc, 12, len);
  CHECK(n >= 2, "more than one piece");
  float ua, va, ub, vb;
  G().place(a, ua, va);
  G().place(b, ub, vb);
  CHECK(len >= std::fabs(ub - ua) + std::fabs(vb - va) - 0.01f, "never shorter than the way along the grid");
  for (uint8_t i = 0; i + 1 < n; i++) {
    float x0, y0, x1, y1;
    G().place(RoadPos{pc[i].seg, pc[i].t1}, x0, y0);
    G().place(RoadPos{pc[i + 1].seg, pc[i + 1].t0}, x1, y1);
    CHECK(std::hypot(x1 - x0, y1 - y0) < 0.001f, "a piece starts where the one before ends");
  }

  section("walk: straight on at a crossing, back at a dead end");
  RoadPos p{0, 0.9f};  // seg 0 runs east along the north edge
  bool towardB = true;
  G().walk(p, towardB, 0.04f);
  float u, v;
  G().place(p, u, v);
  CHECK(std::fabs(v) < 0.001f && u > 0.2f, "went on east along the same line");
}

// --- motion smoother ----------------------------------------------------------------

struct DriveResult {
  float maxStep = 0;     // largest move of the dot between two frames, board units
  float maxOffRoad = 0;  // furthest the dot was from a road
  float maxLag = 0;      // furthest from the true place
  bool passedNode = false;
};

/** A motorcycle drives along the roads; states come at `rateHz`; the dot is drawn at 60 Hz. */
static DriveResult drive(float rateHz, float speedMs, uint32_t ms, uint32_t dropFromMs = 0xFFFFFFFF) {
  MotionSmoother sm;
  RoadPos truth{1, 0.2f};
  bool towardB = true;
  DriveResult r;
  float lastU = -1, lastV = -1;
  const uint32_t stateEvery = static_cast<uint32_t>(1000.0f / rateHz);
  for (uint32_t now = 0; now < ms; now += 16) {
    G().walk(truth, towardB, speedMs / 500.0f * 0.016f);
    if (now % stateEvery < 16 && now < dropFromMs) {
      BoardState s;
      s.players.push_back(player(0, truth, speedMs, towardB));
      sm.onState(s, now);
    }
    sm.update(now);
    const SmoothDot& d = sm.dot(0);
    if (lastU >= 0) r.maxStep = std::fmax(r.maxStep, std::hypot(d.u - lastU, d.v - lastV));
    r.maxOffRoad = std::fmax(r.maxOffRoad, offRoad(d.u, d.v));
    float tu, tv;
    G().place(truth, tu, tv);
    if (now > 500 && now < dropFromMs) r.maxLag = std::fmax(r.maxLag, std::hypot(tu - d.u, tv - d.v));
    for (uint8_t n = 0; n < G().nodeCount(); n++) {
      if (std::hypot(G().node(n).u - d.u, G().node(n).v - d.v) < 0.004f) r.passedNode = true;
    }
    lastU = d.u;
    lastV = d.v;
  }
  return r;
}

static void testSmoother() {
  const float led = 0.2f / 13;  // one LED step
  for (float rate : {10.0f, 15.0f, 30.0f}) {
    std::printf("- smoother at %.0f states per second\n", rate);
    const DriveResult r = drive(rate, 14, 20000);
    std::printf("    largest step %.4f (LED %.4f), off road %.5f, lag %.3f\n", r.maxStep, led, r.maxOffRoad, r.maxLag);
    CHECK(r.maxStep < led * 0.6f, "the dot never jumps: less than one LED per frame at 14 m/s");
    CHECK(r.maxOffRoad < 0.001f, "the dot stays on the road, never across a block");
    CHECK(r.maxLag < 0.06f, "the dot stays close to the real place");
    CHECK(r.passedNode, "the dot went through an intersection");
  }

  section("smoother: around a corner it goes through the intersection");
  {
    MotionSmoother sm;
    // Seg 0 runs east from node (0,0); seg 1 is the vertical road down from (0.2, 0)? Use the graph.
    const RoadPos before{0, 0.92f};
    const uint8_t n = G().endNode(0, true);
    uint8_t down = kNoSegment;
    for (uint8_t i = 0; i < G().node(n).linkCount; i++) {
      const uint8_t s = G().node(n).links[i];
      const auto& o = G().node(G().segment(s).a == n ? G().segment(s).b : G().segment(s).a);
      if (o.v > G().node(n).v + 0.1f) down = s;
    }
    CHECK(down != kNoSegment, "a road goes south from the crossing");
    const bool downTowardB = G().segment(down).a == n;
    const RoadPos after{down, downTowardB ? 0.08f : 0.92f};
    BoardState s1, s2;
    s1.players.push_back(player(0, before, 10, true));
    s2.players.push_back(player(0, after, 10, downTowardB));
    sm.onState(s1, 0);
    sm.onState(s1, 100);
    sm.onState(s2, 200);
    bool atNode = false, cut = false;
    for (uint32_t now = 200; now <= 300; now += 4) {
      sm.update(now);
      const SmoothDot& d = sm.dot(0);
      if (std::hypot(d.u - G().node(n).u, d.v - G().node(n).v) < 0.003f) atNode = true;
      if (offRoad(d.u, d.v) > 0.001f) cut = true;
    }
    CHECK(atNode, "the dot reached the corner");
    CHECK(!cut, "the dot did not cut across the block");
  }

  section("smoother: lost states, the dot goes on with its last speed, then stops");
  {
    const DriveResult r = drive(15, 10, 6000, 3000);
    CHECK(r.maxStep < 0.2f / 13 * 0.6f, "no jump when the states stop");
    MotionSmoother sm;
    BoardState s;
    s.players.push_back(player(0, RoadPos{1, 0.2f}, 10, true));
    sm.onState(s, 0);
    sm.onState(s, 66);
    sm.update(140);
    const float u0 = sm.dot(0).u;
    sm.update(1140);
    const float u1 = sm.dot(0).u;
    CHECK(std::fabs((u1 - u0) - 10.0f / 500.0f) < 0.004f, "1 s at 10 m/s moves 10 m along the road");
    sm.update(5000);
    const float u2 = sm.dot(0).u;
    sm.update(9000);
    CHECK(std::fabs(sm.dot(0).u - u2) < 1e-6f, "after the coast time the dot stands still");
  }
}

// --- layers, effects, phases -----------------------------------------------------------

static BoardConfig config() {
  BoardConfig c;
  c.tail = 2;
  c.dpBlinkHz = 1.0f;
  return c;  // tones all 0: the default palette is used
}

static void testColours() {
  section("colours: the 8 player tones differ by hue, not only by brightness");
  float minD = 1e9f;
  for (int i = 0; i < 8; i++) {
    for (int j = i + 1; j < 8; j++) {
      auto norm = [](Rgb c, float out[3]) {
        const float m = std::fmax(1.0f, std::fmax(c.r, std::fmax(c.g, c.b)));
        out[0] = c.r / m, out[1] = c.g / m, out[2] = c.b / m;
      };
      float a[3], b[3];
      norm(kDefaultTones[i], a);
      norm(kDefaultTones[j], b);
      minD = std::fmin(minD, std::sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) +
                                       (a[2] - b[2]) * (a[2] - b[2])));
    }
  }
  std::printf("    smallest colour distance after taking out brightness: %.2f\n", minD);
  CHECK(minD > 0.3f, "every pair of tones is a clearly different colour");
}

static void testLayers() {
  const BoardConfig cfg = config();
  BoardRenderer r;
  Frame f;

  section("searching view: roads dark, stores soft white");
  r.draw(f, 1500, cfg, LinkState::Searching);
  bool roadsDark = true, storesOn = true;
  for (uint16_t i = 0; i < kLedCount; i++) {
    if (mapdata::kLeds[i].segment >= 0 && !dark(f[i])) roadsDark = false;
    if (mapdata::kLeds[i].store >= 0 && dark(f[i])) storesOn = false;
  }
  CHECK(roadsDark && storesOn, "searching: roads dark, stores lit");

  section("layers: obstacles over roads, bikes over obstacles, four obstacle looks");
  BoardState s;
  s.phase = 2;
  s.obstacles = {{12, 1, 0}, {27, 2, 0}, {40, 3, 0}, {51, 4, 0}};
  const RoadPos onWork{27, 0.5f};
  s.players.push_back(player(0, onWork, 0, true));
  r.onState(s, 0);
  r.draw(f, 100, cfg, LinkState::Connected);
  const uint16_t bikeLed = ledOnSegment(27, 0.5f);
  CHECK(same(f[bikeLed], kDefaultTones[0]), "the dot covers the obstacle under it");
  int redWork = 0, blue = 0;
  for (uint8_t k = 0; k < mapdata::kSegments[27].count; k++) {
    const Rgb c = f[mapdata::kSegments[27].first + k];
    if (c.r > 200 && c.g == 0 && c.b == 0) redWork++;
  }
  for (uint8_t k = 0; k < mapdata::kSegments[51].count; k++) {
    const Rgb c = f[mapdata::kSegments[51].first + k];
    if (c.b > c.r && c.b > 100) blue++;
  }
  CHECK(redWork >= 6, "road work is red");
  CHECK(blue == mapdata::kSegments[51].count, "a puddle is light blue on the whole road");
  // The three red patterns differ from each other over time.
  std::set<int> looks[3];
  for (uint32_t now = 0; now < 2000; now += 50) {
    r.draw(f, now, cfg, LinkState::Connected);
    const uint8_t segs[3] = {12, 27, 40};
    for (int i = 0; i < 3; i++) {
      int code = 0;
      for (uint8_t k = 0; k < 6; k++) code = code * 2 + (f[mapdata::kSegments[segs[i]].first + k].r > 128);
      looks[i].insert(code);
    }
  }
  CHECK(looks[0].size() > 1, "heavy traffic moves");
  CHECK(looks[1].size() <= 2, "road work stands still (the bike may sit on it)");
  CHECK(looks[2].size() == 2, "an accident blinks");

  section("two dots on one LED take turns");
  BoardRenderer r2;
  BoardState s2;
  s2.phase = 2;
  s2.players.push_back(player(0, RoadPos{5, 0.5f}, 0, true));
  s2.players.push_back(player(3, RoadPos{5, 0.5f}, 0, true));
  r2.onState(s2, 0);
  const uint16_t both = ledOnSegment(5, 0.5f);
  std::set<int> seen;
  for (uint32_t now = 100; now < 1300; now += 50) {
    r2.draw(f, now, cfg, LinkState::Connected);
    if (same(f[both], kDefaultTones[0])) seen.insert(0);
    if (same(f[both], kDefaultTones[3])) seen.insert(3);
  }
  CHECK(seen.size() == 2, "both colours are shown on the shared LED");

  section("find me: 1 s white, then the player colour again");
  BoardRenderer r3;
  BoardState s3;
  s3.phase = 2;
  s3.players.push_back(player(2, RoadPos{8, 0.5f}, 0, true));
  s3.players[0].flags |= boardlink::kFindMe;
  r3.onState(s3, 1000);
  const uint16_t fm = ledOnSegment(8, 0.5f);
  r3.draw(f, 1500, cfg, LinkState::Connected);
  CHECK(same(f[fm], Rgb{255, 255, 255}), "white right after the button");
  r3.draw(f, 2100, cfg, LinkState::Connected);
  CHECK(same(f[fm], kDefaultTones[2]), "player colour after 1 s (player 2 = team 1, light)");

  section("delivery point blinks in its player colour, flashes when delivered");
  BoardRenderer r4;
  BoardState s4;
  s4.phase = 2;
  s4.players.push_back(player(1, RoadPos{0, 0.1f}, 0, true));
  float pu, pv;
  G().place(RoadPos{30, 0.5f}, pu, pv);
  boardlink::DeliveryPoint dp;
  dp.owner = 1;
  dp.u = pu;
  dp.v = pv;
  s4.points.push_back(dp);
  r4.onState(s4, 0);
  const uint16_t dpl = nearestRoadLed(pu, pv);
  r4.draw(f, 100, cfg, LinkState::Connected);
  const Rgb on = f[dpl];
  r4.draw(f, 600, cfg, LinkState::Connected);
  const Rgb off = f[dpl];
  CHECK(same(on, kDefaultTones[1]) && !same(off, kDefaultTones[1]), "blinks once per second in the owner colour");
  s4.points[0].delivered = 1;
  r4.onState(s4, 1000);
  r4.draw(f, 1050, cfg, LinkState::Connected);
  CHECK(f[dpl].r > 200 && f[dpl].g > 200 && f[dpl].b > 200, "bright flash at the point");
  r4.draw(f, 1800, cfg, LinkState::Connected);
  CHECK(f[dpl].r < 60, "the flash is short");

  section("earthquake: a ring grows from the centre and fades");
  BoardRenderer r5;
  BoardState s5;
  s5.phase = 2;
  s5.quake = {true, 0.5f, 0.5f, 8, 0};
  r5.onState(s5, 0);
  auto ringRadius = [&](uint32_t now) {
    r5.draw(f, now, cfg, LinkState::Connected);
    float best = 0, bestD = 0;
    for (uint16_t i = 0; i < kLedCount; i++) {
      const float lit = f[i].r - 18.0f;
      const float d = std::hypot(ledU(i) - 0.5f, ledV(i) - 0.5f);
      if (lit > best) best = lit, bestD = d;
    }
    return bestD;
  };
  const float d0 = ringRadius(100), d1 = ringRadius(900);
  std::printf("    ring radius %.2f then %.2f\n", d0, d1);
  CHECK(d1 > d0 + 0.15f, "the ring grows");
}

static void testPhases() {
  section("phase views: lobby, countdown, game, pause, end and draw look different");
  const BoardConfig cfg = config();
  auto total = [](const Frame& f) {
    long t = 0;
    for (auto& c : f) t += c.r + c.g + c.b;
    return t;
  };
  long sums[5];
  for (uint8_t ph = 0; ph < 5; ph++) {
    BoardRenderer r;
    BoardState s;
    s.phase = ph;
    s.timeLeft = 2;
    s.players.push_back(player(0, RoadPos{3, 0.5f}, 0, true));
    r.onState(s, 0);
    Frame f;
    r.draw(f, 500, cfg, LinkState::Connected);
    sums[ph] = total(f);
    CHECK(sums[ph] > 0, "every phase lights something");
  }
  CHECK(sums[3] < sums[2], "pause is darker than the game");

  BoardRenderer end;
  BoardState s;
  s.phase = 4;
  end.onState(s, 0);
  end.setWinners(0x09);  // draw between team 0 and team 3
  Frame f;
  std::set<int> hues;
  for (uint32_t now = 0; now < 4000; now += 100) {
    end.draw(f, now, cfg, LinkState::Connected);
    for (uint16_t i = 0; i < kLedCount; i++) {
      if (mapdata::kLeds[i].segment >= 0 && f[i].r + f[i].g + f[i].b > 200) {
        hues.insert(f[i].b > f[i].r ? 0 : 3);
        break;
      }
    }
  }
  CHECK(hues.size() == 2, "a draw shows the colours of both winners");
}

// --- demo mode -------------------------------------------------------------------------

static void testDemo() {
  section("demo mode: a whole game with no server, every phase and effect");
  DemoMode demo;
  BoardRenderer r;
  const BoardConfig cfg = config();
  Frame f;
  std::set<int> phases;
  bool searching = false, quake = false, flash = false, findMe = false, fallen = false;
  float maxStep = 0;
  float last[8][2];
  bool have[8] = {};
  for (uint32_t now = 0; now < DemoMode::kLoopMs; now += 16) {
    DemoFrame d = demo.step(now);
    if (d.newState) {
      r.onState(d.state, now);
      phases.insert(d.state.phase);
      if (d.state.quake.on) quake = true;
      for (auto& p : d.state.points) flash |= p.delivered;
      for (auto& p : d.state.players) {
        findMe |= (p.flags & boardlink::kFindMe) != 0;
        fallen |= (p.flags & boardlink::kFallen) != 0;
      }
    }
    if (d.link != LinkState::Connected) searching = true;
    r.setWinners(d.winners);
    r.draw(f, now, cfg, d.link);
    if (d.state.phase == 2 || d.state.phase == 3) {
      for (uint8_t i = 0; i < 8; i++) {
        const SmoothDot& dot = r.smoother().dot(i);
        if (!dot.active) continue;
        if (have[i]) maxStep = std::fmax(maxStep, std::hypot(dot.u - last[i][0], dot.v - last[i][1]));
        last[i][0] = dot.u;
        last[i][1] = dot.v;
        have[i] = true;
      }
    }
  }
  CHECK(phases.size() == 5, "lobby, countdown, game, pause and end are all shown");
  CHECK(searching, "the searching view is shown");
  CHECK(quake && flash && findMe && fallen, "earthquake, delivery flash, find me and a fall are shown");
  std::printf("    largest dot step in the demo %.4f\n", maxStep);
  CHECK(maxStep < 0.2f / 13, "no dot jumps by a whole LED in one frame");
}

int main() {
  testGraph();
  testSmoother();
  testColours();
  testLayers();
  testPhases();
  testDemo();
  std::printf("%d checks, %d failed\n", checks, failed);
  return failed == 0 ? 0 : 1;
}
