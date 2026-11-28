// Test helpers for the link part: a fake network and a small server that plays
// the server side of contracts/board_protocol.md, both on a virtual clock.
#pragma once
#include <cstdint>
#include <deque>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "../../src/link/net.h"
#include "../../src/link/protocol.h"

namespace sim {

using boardlink::Deframer;
using boardlink::Frame;
using boardlink::TcpState;
using Bytes = std::vector<uint8_t>;

constexpr const char* kServerIp = "10.0.0.2";
constexpr const char* kBoardIp = "10.0.0.50";

/** Everything between the board and the server. */
struct Wire {
  bool wifiUp = true;          // the router
  bool serverUp = true;
  bool broadcastHeard = true;  // false: the search must use the backup address
  double udpLossPct = 0;
  uint32_t rng = 12345;

  std::deque<std::pair<std::string, Bytes>> toBoardUdp;
  std::deque<Bytes> toServerUdp;
  bool tcpOpen = false;
  bool newConnection = false;
  Bytes toBoardTcp, toServerTcp;

  bool lost() {
    rng = rng * 1664525u + 1013904223u;
    return (rng >> 8) % 10000 < udpLossPct * 100;
  }
  void breakTcp() {
    tcpOpen = false;
    toBoardTcp.clear();
    toServerTcp.clear();
  }
};

/** The board's side of the wire. */
class FakeNet : public boardlink::Net {
 public:
  explicit FakeNet(Wire& w) : w_(w) {}

  bool ready() override { return w_.wifiUp; }

  void udpSendTo(const std::string& host, uint16_t, const uint8_t* d, size_t n) override {
    if (w_.wifiUp && w_.serverUp && host == kServerIp && !w_.lost()) w_.toServerUdp.emplace_back(d, d + n);
  }
  void udpBroadcast(uint16_t, const uint8_t* d, size_t n) override {
    if (w_.wifiUp && w_.serverUp && w_.broadcastHeard && !w_.lost()) w_.toServerUdp.emplace_back(d, d + n);
  }
  size_t udpReceive(uint8_t* buf, size_t cap, std::string& from) override {
    if (w_.toBoardUdp.empty()) return 0;
    auto p = std::move(w_.toBoardUdp.front());
    w_.toBoardUdp.pop_front();
    if (!w_.wifiUp || p.second.size() > cap) return 0;
    from = p.first;
    std::copy(p.second.begin(), p.second.end(), buf);
    return p.second.size();
  }
  void tcpConnect(const std::string& host, uint16_t) override {
    connectCalls++;
    if (w_.wifiUp && w_.serverUp && host == kServerIp) {
      w_.breakTcp();
      w_.tcpOpen = true;
      w_.newConnection = true;
      st_ = TcpState::Connecting;  // open on the next look
    } else {
      st_ = TcpState::Closed;
    }
  }
  TcpState tcpState() override {
    if (st_ != TcpState::Closed && (!w_.tcpOpen || !w_.wifiUp)) st_ = TcpState::Closed;
    if (st_ == TcpState::Connecting) st_ = TcpState::Open;
    return st_;
  }
  bool tcpSend(const uint8_t* d, size_t n) override {
    if (tcpState() != TcpState::Open) return false;
    w_.toServerTcp.insert(w_.toServerTcp.end(), d, d + n);
    return true;
  }
  size_t tcpReceive(uint8_t* buf, size_t cap) override {
    if (tcpState() != TcpState::Open || w_.toBoardTcp.empty()) return 0;
    size_t n = std::min(cap, w_.toBoardTcp.size());
    std::copy(w_.toBoardTcp.begin(), w_.toBoardTcp.begin() + static_cast<long>(n), buf);
    w_.toBoardTcp.erase(w_.toBoardTcp.begin(), w_.toBoardTcp.begin() + static_cast<long>(n));
    return n;
  }
  void tcpClose() override {
    if (st_ != TcpState::Closed) w_.breakTcp();
    st_ = TcpState::Closed;
  }

  int connectCalls = 0;

 private:
  Wire& w_;
  TcpState st_ = TcpState::Closed;
};

/** Server side, as M2-4 does it, in a few lines. */
class SimServer {
 public:
  SimServer(Wire& w, uint32_t sid) : w_(w), sid_(sid) {}

  // what the tests look at
  int tcpHellos = 0, statuses = 0, sensors = 0, pongs = 0, badIn = 0;
  std::vector<uint32_t> quakeSeqsUsed;  // each earthquake event once
  int quakeMessages = 0;                // with the ones sent again
  std::set<std::string> answered;       // "C:1", "V:3"
  uint32_t lastPongStateSeq = 0;

  // knobs
  bool sendStates = true;
  int ignoreQuakes = 0;  // do not answer the first N earthquake messages
  uint16_t timeLeft = 300;

  void restart(uint32_t newSid) {
    w_.breakTcp();
    w_.toServerUdp.clear();
    sid_ = newSid;
    seq_.clear();
    connected_ = false;
    df_.clear();
    quakeSeen_.clear();
  }

  void step(uint32_t now) {
    if (!w_.serverUp) {
      w_.toServerUdp.clear();
      return;
    }
    while (!w_.toServerUdp.empty()) {
      Bytes b = std::move(w_.toServerUdp.front());
      w_.toServerUdp.pop_front();
      onUdp(b, now);
    }
    if (w_.newConnection) {
      w_.newConnection = false;
      df_.clear();
      quakeSeen_.clear();
      connected_ = false;
    }
    if (!w_.tcpOpen) connected_ = false;
    if (!w_.toServerTcp.empty()) {
      df_.push(w_.toServerTcp.data(), w_.toServerTcp.size());
      w_.toServerTcp.clear();
      Bytes m;
      while (df_.next(m)) onTcp(m, now);
    }
    if (connected_ && sendStates && now - lastState_ >= 33) {
      lastState_ = now;
      udp(make('S', state()));
    }
    if (connected_ && now - lastProbe_ >= 500) {
      lastProbe_ = now;
      udp(make('P', mp::Value::object()));
    }
  }

  void vibrate(uint8_t mask, double duty, int ms, int ramp, bool twice = false) {
    mp::Value d = mp::Value::object();
    d.set("mask", mp::Value::integer(mask)).set("duty", mp::Value::real(duty)).set("ms", mp::Value::integer(ms)).set("ramp_ms", mp::Value::integer(ramp));
    Bytes b = make('V', d, true);
    tcp(b);
    if (twice) tcp(b);  // sent again with the same seq
  }

  /** A state message with any order number (for the late packet test). */
  void stateWithSeq(uint32_t seq) {
    mp::Value m = head('S', seq);
    m.set("d", state());
    w_.toBoardUdp.emplace_back(kServerIp, enc(m));
  }

  void rawUdp(const Bytes& b, const char* from = kServerIp) { w_.toBoardUdp.emplace_back(from, b); }
  void rawTcp(const Bytes& b) {
    if (w_.tcpOpen) w_.toBoardTcp.insert(w_.toBoardTcp.end(), b.begin(), b.end());
  }

  bool connected() const { return connected_; }
  uint32_t sid() const { return sid_; }

 private:
  mp::Value state() const {
    mp::Value p = mp::Value::array();
    mp::Value p0 = mp::Value::array();
    for (double x : {2.0, 1.0, 0.0, 13.0, 0.4248, 0.1962, 88.0, 11.2}) p0.push(x == static_cast<int>(x) ? mp::Value::integer(static_cast<int64_t>(x)) : mp::Value::real(x));
    p.push(p0);
    mp::Value ob = mp::Value::array();
    mp::Value o = mp::Value::array();
    o.push(mp::Value::integer(12)).push(mp::Value::integer(2)).push(mp::Value::integer(0));
    ob.push(o);
    mp::Value d = mp::Value::object();
    d.set("ph", mp::Value::integer(2)).set("tl", mp::Value::integer(timeLeft)).set("p", p).set("dp", mp::Value::array()).set("ob", ob).set("eq", mp::Value::array());
    return d;
  }

  mp::Value head(char t, uint32_t seq) const {
    mp::Value m = mp::Value::object();
    m.set("t", mp::Value::str(std::string(1, t))).set("v", mp::Value::integer(1)).set("sid", mp::Value::integer(sid_)).set("seq", mp::Value::integer(seq)).set("ts", mp::Value::integer(0));
    return m;
  }

  Bytes make(char t, const mp::Value& d, bool ack = false) {
    mp::Value m = head(t, ++seq_[t]);
    if (ack) m.set("ack", mp::Value::boolean(true));
    m.set("d", d);
    return enc(m);
  }

  static Bytes enc(const mp::Value& m) {
    Bytes b;
    mp::encode(m, b);
    return b;
  }

  void udp(const Bytes& b) {
    if (w_.wifiUp && !w_.lost()) w_.toBoardUdp.emplace_back(kServerIp, b);
  }
  void tcp(const Bytes& b) {
    if (!w_.tcpOpen) return;
    auto f = boardlink::frameTcp(b);
    w_.toBoardTcp.insert(w_.toBoardTcp.end(), f.begin(), f.end());
  }

  void onUdp(const Bytes& b, uint32_t) {
    Frame f;
    if (boardlink::decodeFrame(b.data(), b.size(), f) != boardlink::DecodeError::None) {
      badIn++;
      return;
    }
    if (f.t == 'H') udp(make('P', mp::Value::object()));  // the answer to the search
    if (f.t == 'N') sensors++;
    if (f.t == 'O') {
      pongs++;
      const mp::Value* s = f.d.get("state_seq");
      if (s) lastPongStateSeq = static_cast<uint32_t>(s->i);
    }
  }

  void onTcp(const Bytes& b, uint32_t) {
    Frame f;
    if (boardlink::decodeFrame(b.data(), b.size(), f) != boardlink::DecodeError::None) {
      badIn++;
      return;
    }
    switch (f.t) {
      case 'H': {
        tcpHellos++;
        connected_ = true;
        mp::Value d = mp::Value::object();
        mp::Value tones = mp::Value::array();
        for (int k = 0; k < 8; ++k) {
          mp::Value c = mp::Value::array();
          c.push(mp::Value::integer(10 * k)).push(mp::Value::integer(20)).push(mp::Value::integer(30));
          tones.push(c);
        }
        d.set("plan", mp::Value::str("0.3.0")).set("bright", mp::Value::real(0.6)).set("max_ma", mp::Value::integer(4000)).set("tones", tones);
        tcp(make('C', d, true));
        break;
      }
      case 'Q': {
        quakeMessages++;
        if (ignoreQuakes > 0) {
          ignoreQuakes--;
          break;
        }
        mp::Value a = head('A', f.seq);
        mp::Value d = mp::Value::object();
        d.set("of", mp::Value::str("Q"));
        a.set("d", d);
        tcp(enc(a));
        if (quakeSeen_.insert(f.seq).second) quakeSeqsUsed.push_back(f.seq);
        break;
      }
      case 'T': statuses++; break;
      case 'A': {
        const mp::Value* of = f.d.get("of");
        answered.insert(std::string(of ? of->s : "?") + ":" + std::to_string(f.seq));
        break;
      }
      default: badIn++;
    }
  }

  Wire& w_;
  uint32_t sid_;
  std::map<char, uint32_t> seq_;
  Deframer df_;
  bool connected_ = false;
  uint32_t lastState_ = 0, lastProbe_ = 0;
  std::set<uint32_t> quakeSeen_;
};

}  // namespace sim
