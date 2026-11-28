// Demo, board side: the link part of the board program on real sockets against the real
// M2-4 server (demo_server.mjs starts both). Once per second it prints what the LED part
// would get. At second 5 it sends a hand hit. Run: make demo
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>

#include "../../src/link/link.h"
#include "net_socket.h"

using namespace boardlink;

static const char* kPhase[] = {"lobby", "countdown", "game", "pause", "end"};
static const char* kState[] = {"searching", "connecting", "connected"};

int main(int argc, char** argv) {
  const uint16_t port = argc > 1 ? static_cast<uint16_t>(std::atoi(argv[1])) : 47191;
  const uint32_t runMs = 1000u * static_cast<uint32_t>(argc > 2 ? std::atoi(argv[2]) : 10);
  SocketNet net;
  LinkSettings s;
  s.backupHost = "127.0.0.1";  // a broadcast does not reach this computer itself
  s.port = port;
  s.backupAfterMs = 0;
  s.fw = "demo";
  Link link(net, s);

  const auto t0 = std::chrono::steady_clock::now();
  auto now = [&]() {
    return static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count());
  };
  uint32_t lastPrint = 0, lastStatus = 0, statesAtPrint = 0;
  bool hitSent = false;
  while (now() < runMs) {
    const uint32_t t = now();
    link.poll(t);
    VibrateCmd v;
    while (link.takeVibrate(v)) {
      std::printf("  [board] vibrate: zones mask %u, duty %.2f, %u ms\n", v.mask, v.duty, v.ms);
    }
    const bool up = link.linkState() == LinkState::Connected;
    if (up && t - lastStatus >= 1000) {
      lastStatus = t;
      StatusOut st;
      st.fw = "demo";
      st.fps = 60;
      link.sendStatus(st);
    }
    if (up && !hitSent && t >= 5000) {
      QuakeOut q;
      q.mag = 6.5f;
      q.zone = 4;
      q.conf = 0.8f;
      q.peakG = 2.5f;
      link.sendQuake(q);
      hitSent = true;
      std::printf("  [board] hand hit sent: strength 6.5, zone 4\n");
    }
    if (t - lastPrint >= 1000) {
      lastPrint = t;
      const auto& stats = link.stats();
      std::printf("[board %2us] %-10s states/s %3u", t / 1000, kState[static_cast<int>(link.linkState())], stats.statesTaken - statesAtPrint);
      statesAtPrint = stats.statesTaken;
      if (link.hasState()) {
        const BoardState& b = link.latestState();
        std::printf("  %s, %us left", b.phase < 5 ? kPhase[b.phase] : "?", b.timeLeft);
        for (const Player& p : b.players) std::printf("  player %u at u %.3f v %.3f, %.0f deg", p.id, p.u, p.v, p.heading);
        std::printf("  obstacles %zu", b.obstacles.size());
        if (b.quake.on) std::printf("  EARTHQUAKE %.1f at u %.2f v %.2f", b.quake.mag, b.quake.u, b.quake.v);
      }
      std::printf("\n");
      std::fflush(stdout);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  const auto& st = link.stats();
  std::printf("[board] states %u, bad messages %u, late dropped %u, connects %u\n", st.statesTaken, st.badMessages, st.lateDropped, st.connects);
  return link.linkState() == LinkState::Connected && st.badMessages == 0 ? 0 : 1;
}
