// PC tests for the link part (M6-1). Run: make test
#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

#include "../../src/link/link.h"
#include "../../src/link/msgpack.h"
#include "../../src/link/protocol.h"
#include "sim.h"

using namespace boardlink;
using Bytes = std::vector<uint8_t>;

static int checks = 0, failed = 0;
#define CHECK(cond, what)                                                  \
  do {                                                                     \
    ++checks;                                                              \
    if (!(cond)) {                                                         \
      ++failed;                                                            \
      std::printf("  FAIL %s:%d: %s  %s\n", __FILE__, __LINE__, #cond, what); \
    }                                                                      \
  } while (0)

static void section(const char* name) { std::printf("- %s\n", name); }

// --- contract vectors ------------------------------------------------------------

struct Vector {
  std::string name, hex;
};

static std::vector<Vector> loadVectors() {
  std::ifstream f("../../../../contracts/board_protocol_vectors.json");
  std::stringstream ss;
  ss << f.rdbuf();
  const std::string s = ss.str();
  std::vector<Vector> out;
  size_t at = 0;
  for (;;) {
    size_t n = s.find("\"name\": \"", at);
    if (n == std::string::npos) break;
    n += 9;
    size_t ne = s.find('"', n);
    size_t h = s.find("\"msgpack_hex\": \"", ne);
    h += 16;
    size_t he = s.find('"', h);
    out.push_back({s.substr(n, ne - n), s.substr(h, he - h)});
    at = he;
  }
  return out;
}

static Bytes unhex(const std::string& h) {
  Bytes b;
  for (size_t k = 0; k + 1 < h.size(); k += 2) b.push_back(static_cast<uint8_t>(std::stoi(h.substr(k, 2), nullptr, 16)));
  return b;
}

static std::string hex(const Bytes& b) {
  static const char* d = "0123456789abcdef";
  std::string s;
  for (uint8_t x : b) {
    s += d[x >> 4];
    s += d[x & 15];
  }
  return s;
}

static bool near(double a, double b) { return std::fabs(a - b) < 1e-4; }

static void testVectors() {
  section("contract vectors: all ten decode, give the same bytes again, and the board messages encode exactly");
  auto vs = loadVectors();
  CHECK(vs.size() == 10, "ten vectors in contracts/board_protocol_vectors.json");
  std::map<std::string, Bytes> by;
  for (auto& v : vs) {
    Bytes b = unhex(v.hex);
    by[v.name] = b;
    mp::Value val;
    CHECK(mp::decode(b.data(), b.size(), val), v.name.c_str());
    Bytes again;
    mp::encode(val, again);
    CHECK(again == b, v.name.c_str());
    Frame f;
    CHECK(decodeFrame(b.data(), b.size(), f) == DecodeError::None, v.name.c_str());
  }

  Frame f;
  decodeFrame(by["state"].data(), by["state"].size(), f);
  BoardState s;
  CHECK(f.t == 'S' && f.seq == 52031 && f.hasSid && f.sid == 1402754, "state frame");
  CHECK(readState(f.d, s), "state content");
  CHECK(s.phase == 2 && s.timeLeft == 239 && s.players.size() == 2, "state phase, time, players");
  CHECK(s.players[0].id == 2 && s.players[0].team == 1 && s.players[0].flags == 13 && near(s.players[0].u, 0.4248), "player 2");
  CHECK(s.points.size() == 1 && s.points[0].owner == 2 && near(s.points[0].v, 0.304), "delivery point");
  CHECK(s.obstacles.size() == 3 && s.obstacles[0].segment == 12 && s.obstacles[0].type == 2, "obstacles");
  CHECK(s.quake.on && near(s.quake.mag, 7) && s.quake.ageMs == 840, "earthquake");

  decodeFrame(by["config"].data(), by["config"].size(), f);
  BoardConfig c;
  CHECK(f.ack && readConfig(f.d, c), "config");
  CHECK(near(c.bright, 0.6) && c.maxMa == 4000 && c.tones[2].g == 255 && c.tail == 2 && near(c.dpBlinkHz, 1.5), "config fields");

  decodeFrame(by["vibrate"].data(), by["vibrate"].size(), f);
  VibrateCmd v;
  CHECK(f.ack && readVibrate(f.d, v) && v.mask == 5 && near(v.duty, 0.8) && v.ms == 1500 && v.rampMs == 200, "vibrate");

  decodeFrame(by["ack"].data(), by["ack"].size(), f);
  CHECK(f.t == 'A' && f.seq == 77 && f.d.get("of") && f.d.get("of")->s == "Q", "answer names the type");

  CHECK(hex(encodeHello(1, 1200, "0.4.1", "0.2.0", "board-01")) == hex(by["hello"]), "hello bytes");
  QuakeOut q;
  q.id = 12; q.motor = false; q.peakG = 3.8f; q.mag = 6.1f; q.u = 0.31f; q.v = 0.72f; q.zone = 6; q.conf = 0.7f;
  CHECK(hex(encodeQuake(77, 123456, q)) == hex(by["quake"]), "quake bytes");
  const float a[] = {0.01f, 0.02f, 0.01f, 0.85f, 2.9f, 3.8f, 1.2f, 0.4f, 0.1f, 0.03f};
  CHECK(hex(encodeSensor(9001, 123400, 100, a, 10)) == hex(by["sensor"]), "sensor bytes");
  StatusOut st;
  st.fw = "0.4.1"; st.fps = 60; st.rssi = -52; st.maEst = 1850; st.heap = 182000;
  CHECK(hex(encodeStatus(310, 310020, st, "0.2.0", 52031)) == hex(by["status"]), "status bytes");
  CHECK(hex(encodePong(620, 310050, 60790, 52031, 9)) == hex(by["pong"]), "pong bytes");
}

// --- bad input -------------------------------------------------------------------

static void testBadInput() {
  section("bad input: refused with a reason, never a crash");
  Frame f;
  const Bytes junk = {0xc1, 0xff, 0x00};
  CHECK(decodeFrame(junk.data(), junk.size(), f) == DecodeError::NotMsgpack, "random bytes");
  CHECK(decodeFrame(nullptr, 0, f) == DecodeError::NotMsgpack, "empty");

  auto frameWith = [](std::function<void(mp::Value&)> edit) {
    mp::Value m = mp::Value::object();
    m.set("t", mp::Value::str("S")).set("v", mp::Value::integer(1)).set("seq", mp::Value::integer(1)).set("ts", mp::Value::integer(0)).set("d", mp::Value::object());
    edit(m);
    Bytes b;
    mp::encode(m, b);
    return b;
  };
  Bytes b = frameWith([](mp::Value& m) { m.map[1].second = mp::Value::integer(2); });
  CHECK(decodeFrame(b.data(), b.size(), f) == DecodeError::BadVersion, "other version");
  b = frameWith([](mp::Value& m) { m.map[0].second = mp::Value::str("X"); });
  CHECK(decodeFrame(b.data(), b.size(), f) == DecodeError::BadType, "unknown type");
  b = frameWith([](mp::Value& m) { m.map[2].second = mp::Value::integer(-1); });
  CHECK(decodeFrame(b.data(), b.size(), f) == DecodeError::BadField, "negative seq");
  b = frameWith([](mp::Value& m) { m.map[4].second = mp::Value::array(); });
  CHECK(decodeFrame(b.data(), b.size(), f) == DecodeError::BadField, "d is a list");
  b = frameWith([](mp::Value& m) { m.set("ack", mp::Value::boolean(false)); });
  CHECK(decodeFrame(b.data(), b.size(), f) == DecodeError::BadField, "ack false");

  const Bytes lie = {0xdd, 0xff, 0xff, 0xff, 0xff};  // "an array of 4 billion items"
  mp::Value v;
  CHECK(!mp::decode(lie.data(), lie.size(), v), "a count larger than the bytes");
  Bytes deep(65, 0x91);  // lists inside lists
  deep.back() = 0x00;
  CHECK(!mp::decode(deep.data(), deep.size(), v), "too deep");
  const Bytes extra = {0x01, 0x02};
  CHECK(!mp::decode(extra.data(), extra.size(), v), "bytes after the value");

  // Wrong values in a state are refused as a whole.
  auto vs = loadVectors();
  Bytes st = unhex(vs[0].hex);
  decodeFrame(st.data(), st.size(), f);
  BoardState s;
  mp::Value d = f.d;
  d.map[2].second.arr[0].arr[0] = mp::Value::integer(9);  // player 9
  CHECK(!readState(d, s), "player number 9");
  d = f.d;
  d.map[2].second.arr[0].arr[4] = mp::Value::real(1.5);  // u outside the board
  CHECK(!readState(d, s), "u 1.5");
  d = f.d;
  d.map[4].second.arr[0].arr[1] = mp::Value::integer(7);  // obstacle type 7
  CHECK(!readState(d, s), "obstacle type 7");
  d = f.d;
  d.map[2].second.arr[0].arr[6] = mp::Value::integer(90);  // a whole number where a float is expected
  CHECK(readState(d, s), "whole number heading is fine");

  // Fuzz: broken copies of every vector and random bytes.
  uint32_t r = 7;
  auto rnd = [&]() { return r = r * 1664525u + 1013904223u; };
  int refused = 0;
  for (int k = 0; k < 20000; ++k) {
    Bytes x = unhex(vs[k % vs.size()].hex);
    int how = rnd() % 3;
    if (how == 0) x[rnd() % x.size()] ^= static_cast<uint8_t>(1u << (rnd() % 8));
    if (how == 1) x.resize(rnd() % x.size());
    if (how == 2) for (auto& y : x) y = static_cast<uint8_t>(rnd() >> 24);
    Frame g;
    if (decodeFrame(x.data(), x.size(), g) != DecodeError::None) {
      refused++;
    } else {
      BoardState s2;
      BoardConfig c2;
      VibrateCmd v2;
      readState(g.d, s2);
      readConfig(g.d, c2);
      readVibrate(g.d, v2);
    }
  }
  CHECK(refused > 10000, "most broken messages are refused (the rest are still valid frames)");
}

static void testFraming() {
  section("TCP framing: any chunk size, too long refused");
  auto vs = loadVectors();
  Bytes stream;
  std::vector<Bytes> msgs;
  for (auto& v : vs) {
    msgs.push_back(unhex(v.hex));
    auto fr = frameTcp(msgs.back());
    stream.insert(stream.end(), fr.begin(), fr.end());
  }
  for (size_t size : {1u, 2u, 3u, 7u, 64u, 4096u}) {
    Deframer d;
    std::vector<Bytes> got;
    for (size_t k = 0; k < stream.size(); k += size) {
      d.push(stream.data() + k, std::min(size, stream.size() - k));
      Bytes m;
      while (d.next(m)) got.push_back(m);
    }
    CHECK(got == msgs && d.pending() == 0, "all messages back");
  }
  Deframer d;
  const Bytes tooLong = {0xff, 0xff, 0x00};
  CHECK(!d.push(tooLong.data(), tooLong.size()), "65535 bytes is too long for the board");
}

// --- the link against the server simulation ---------------------------------------

struct Rig {
  sim::Wire w;
  sim::FakeNet net{w};
  sim::SimServer server{w, 1111};
  Link link;
  uint32_t t = 0;

  explicit Rig(LinkSettings s = settings()) : link(net, std::move(s)) {}

  static LinkSettings settings() {
    LinkSettings s;
    s.backupHost = sim::kServerIp;
    return s;
  }

  /** Runs the server and the main loop every 5 ms of board time. */
  void run(uint32_t ms, const std::function<void()>& each = nullptr) {
    for (uint32_t end = t + ms; t < end; t += 5) {
      server.step(t);
      link.poll(t);
      if (each) each();
    }
  }
};

static void testConnect() {
  section("search, connect, config, states, delay replies, status");
  Rig r;
  r.run(3000, [&]() {
    if (r.t % 1000 == 0) {
      StatusOut st;
      st.fw = "test";
      r.link.sendStatus(st);
    }
  });
  CHECK(r.link.linkState() == LinkState::Connected, "connected");
  CHECK(r.server.tcpHellos == 1 && r.link.stats().connects == 1, "one hello on TCP");
  CHECK(r.link.hasConfig() && r.link.configVersion() == 1 && near(r.link.config().bright, 0.6), "config handed over");
  CHECK(r.server.answered.count("C:1") == 1, "config answered with of C");
  CHECK(r.link.hasState() && r.link.latestState().timeLeft == 300, "state handed over");
  CHECK(r.link.stateVersion() > 70, "about 30 states per second");
  CHECK(r.server.pongs >= 4 && r.server.lastPongStateSeq > 0, "delay probes answered with the state in use");
  CHECK(r.server.statuses >= 1, "status reports arrive");
  CHECK(r.link.stats().badMessages == 0, "no bad message");
}

static void testHandover() {
  section("state hand over: the version moves only with a new state");
  Rig r;
  r.run(2000);
  uint32_t v = r.link.stateVersion();
  r.server.sendStates = false;
  r.run(500);
  CHECK(r.link.stateVersion() == v, "no new state, same version");
  r.server.sendStates = true;
  r.server.timeLeft = 123;
  r.run(100);
  CHECK(r.link.stateVersion() > v && r.link.latestState().timeLeft == 123, "new state, new version");
}

static void testBackup() {
  section("no answer to the broadcast: the backup address is used");
  Rig r;
  r.w.broadcastHeard = false;
  r.run(4500);
  CHECK(r.link.linkState() == LinkState::Searching, "still searching before 5 s");
  r.run(3000);
  CHECK(r.link.linkState() == LinkState::Connected, "connected through the backup address");
}

static void testQuake() {
  section("earthquake event: sent again until answered, used once");
  Rig r;
  r.run(2000);
  r.server.ignoreQuakes = 2;
  QuakeOut q;
  q.mag = 6.5f;
  q.zone = 4;
  r.link.sendQuake(q);
  r.run(4000);
  CHECK(r.server.quakeSeqsUsed.size() == 1, "used once");
  CHECK(r.server.quakeMessages == 3, "sent three times: two without an answer");
  CHECK(r.link.stats().resends == 2, "two resends, then the answer stops them");
}

static void testVibrate() {
  section("vibrate: answered every time, used once");
  Rig r;
  r.run(2000);
  r.server.vibrate(5, 0.8, 1500, 200, true);
  r.run(100);
  VibrateCmd v;
  CHECK(r.link.takeVibrate(v) && v.mask == 5 && v.ms == 1500, "one command");
  CHECK(!r.link.takeVibrate(v), "not twice");
  CHECK(r.server.answered.count("V:1") == 1, "answered with of V");
}

static void testLate() {
  section("late UDP packets are dropped");
  Rig r;
  r.run(1000);
  r.server.sendStates = false;
  r.run(100);
  r.server.stateWithSeq(1000);
  r.server.stateWithSeq(990);
  r.server.stateWithSeq(1000);
  r.run(20);
  CHECK(r.link.latestState().seq == 1000, "newest kept");
  CHECK(r.link.stats().lateDropped == 2, "older and repeated dropped");
}

static void testHeavyLoss() {
  section("heavy loss (50 % of UDP both ways): the link stays and the states keep coming");
  Rig r;
  r.run(2000);
  r.w.udpLossPct = 50;
  uint32_t searches = r.link.stats().searches;
  uint32_t v = r.link.stateVersion();
  bool alwaysConnected = true;
  r.run(60000, [&]() { alwaysConnected &= r.link.linkState() == LinkState::Connected; });
  uint32_t got = r.link.stateVersion() - v;
  CHECK(alwaysConnected && r.link.stats().searches == searches, "never lost");
  CHECK(got > 770 && got < 950, "about half of 1714 states (one every 35 ms)");
  CHECK(r.link.stats().badMessages == 0, "no bad message");
}

static void testServerRestart() {
  section("server restart: new session number, the order numbers start again");
  Rig r;
  r.run(3000);
  uint32_t oldSeq = r.link.latestState().seq;
  r.server.restart(2222);
  r.server.timeLeft = 299;
  bool searching = false;
  uint32_t firstNewSeq = 0;
  r.run(4000, [&]() {
    searching |= r.link.linkState() == LinkState::Searching;
    if (firstNewSeq == 0 && r.link.latestState().timeLeft == 299) firstNewSeq = r.link.latestState().seq;
  });
  CHECK(searching, "the closed channel sent the board searching");
  CHECK(r.link.linkState() == LinkState::Connected, "connected to the new server");
  CHECK(r.link.stats().sidChanges == 1, "new session number seen");
  CHECK(r.link.latestState().timeLeft == 299, "the new server's states are used");
  CHECK(firstNewSeq > 0 && firstNewSeq < oldSeq, "even though their numbers start lower");
}

static void testRouterRestart() {
  section("router restart: searching at once, back by itself");
  Rig r;
  r.run(2000);
  r.w.wifiUp = false;
  r.w.breakTcp();
  r.run(10);
  CHECK(r.link.linkState() == LinkState::Searching, "searching at once (motors stop)");
  r.run(10000);
  CHECK(r.link.linkState() == LinkState::Searching, "still searching while it is down");
  r.w.wifiUp = true;
  r.run(2000);
  CHECK(r.link.linkState() == LinkState::Connected, "connected again within 2 s");
}

static void testSilentServer() {
  section("no state for 1 s: searching");
  Rig r;
  r.run(2000);
  r.server.sendStates = false;
  uint32_t searches = r.link.stats().searches;
  r.run(900);
  CHECK(r.link.stats().searches == searches, "0.9 s is fine");
  r.run(200);
  // It searches; the server is still there, so it connects again at once.
  CHECK(r.link.stats().searches == searches + 1, "after 1 s it searches");
}

static void testBadPackets() {
  section("bad packets do not stop the board");
  Rig r;
  r.run(2000);
  r.server.rawUdp({0xc1, 0xc1});
  r.server.rawUdp({});
  r.server.rawUdp({0x01}, "10.0.0.99");  // a stranger
  auto junk = frameTcp({0xc1, 0xc1, 0xc1});
  r.server.rawTcp(junk);
  r.run(100);
  CHECK(r.link.linkState() == LinkState::Connected, "still connected");
  CHECK(r.link.stats().badMessages >= 2, "counted");
  r.server.rawTcp({0xff, 0xff});  // a length the board cannot hold
  bool searched = false;
  r.run(3000, [&]() { searched |= r.link.linkState() != LinkState::Connected; });
  CHECK(searched && r.link.linkState() == LinkState::Connected, "broken channel closed, then connected again");
}

static void testLongRun() {
  section("long run: 10 minutes with 5 % loss");
  Rig r;
  r.run(2000);
  r.w.udpLossPct = 5;
  uint32_t searches = r.link.stats().searches;
  uint32_t v = r.link.stateVersion();
  r.run(600000, [&]() {
    if (r.t % 100 == 0) {
      float a[10] = {};
      r.link.sendSensor(100, a, 10);
    }
  });
  uint32_t got = r.link.stateVersion() - v;
  CHECK(r.link.stats().searches == searches, "never lost");
  // The simulated server sends every 35 ms (its 33 ms in 5 ms steps): 17 143 states.
  CHECK(got > 15900 && got < 16700, "about 95 % of 17 143 states");
  CHECK(r.server.sensors > 5000, "sensor groups arrive");
  CHECK(r.link.stats().badMessages == 0 && r.server.badIn == 0, "no bad message either way");
}

int main() {
  testVectors();
  testBadInput();
  testFraming();
  testConnect();
  testHandover();
  testBackup();
  testQuake();
  testVibrate();
  testLate();
  testHeavyLoss();
  testServerRestart();
  testRouterRestart();
  testSilentServer();
  testBadPackets();
  testLongRun();
  std::printf("\n%d checks, %d failed\n", checks, failed);
  return failed ? 1 : 0;
}
