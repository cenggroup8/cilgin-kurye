// Integration test, board side: the link part on real sockets against the
// real server of M2-4 (itest_server.mjs starts it). Run: make itest
#include <chrono>
#include <cstdio>
#include <thread>

#include "../../src/link/link.h"
#include "net_socket.h"

using namespace boardlink;

int main(int argc, char** argv) {
  const uint16_t port = argc > 1 ? static_cast<uint16_t>(std::atoi(argv[1])) : 47190;
  SocketNet net;
  LinkSettings s;
  s.backupHost = "127.0.0.1";  // a broadcast does not reach this computer itself
  s.port = port;
  s.backupAfterMs = 0;
  s.fw = "itest";
  Link link(net, s);

  const auto t0 = std::chrono::steady_clock::now();
  auto now = [&]() {
    return static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count());
  };
  bool quakeSent = false;
  int vibrates = 0;
  uint32_t lastStatus = 0, lastSensor = 0;
  while (now() < 6000) {
    uint32_t t = now();
    link.poll(t);
    VibrateCmd v;
    while (link.takeVibrate(v)) vibrates++;
    if (link.linkState() == LinkState::Connected) {
      if (!quakeSent && link.hasState()) {
        QuakeOut q;
        q.mag = 6.5f;
        q.zone = 4;
        q.conf = 0.8f;
        q.peakG = 2.5f;
        link.sendQuake(q);
        quakeSent = true;
      }
      if (t - lastStatus >= 1000) {
        lastStatus = t;
        StatusOut st;
        st.fw = "itest";
        link.sendStatus(st);
      }
      if (t - lastSensor >= 100) {
        lastSensor = t;
        float a[10] = {0.01f, 0.02f, 0.03f, 0.02f, 0.01f, 0.02f, 0.03f, 0.02f, 0.01f, 0.02f};
        link.sendSensor(100, a, 10);
      }
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }

  const auto& st = link.stats();
  int failed = 0;
  auto check = [&](bool ok, const char* what) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what);
    failed += !ok;
  };
  std::printf("board side:\n");
  check(link.linkState() == LinkState::Connected, "connected to the M2-4 server");
  check(st.connects == 1, "one connection");
  check(link.hasConfig() && link.config().bright > 0.59f && link.config().bright < 0.61f, "config from the server");
  check(st.statesTaken > 100, "board states arrive (30 per second)");
  check(link.latestState().timeLeft == 200, "state content");
  check(vibrates == 1, "one vibrate command");
  check(st.badMessages == 0 && st.lateDropped == 0, "no bad or late message");
  std::printf("  states %u, resends %u\n", st.statesTaken, st.resends);
  return failed ? 1 : 0;
}
