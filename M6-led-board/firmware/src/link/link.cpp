#include "link.h"

namespace boardlink {

namespace {
constexpr size_t kUdpMax = 1500;
constexpr int kMaxUdpPerPoll = 32;  // so one poll stays short
constexpr size_t kMaxVibrates = 4;
constexpr size_t kMaxQuakes = 8;
}  // namespace

Link::Link(Net& net, LinkSettings settings) : net_(net), set_(std::move(settings)) {}

void Link::poll(uint32_t now) {
  now_ = now;
  if (!net_.ready()) {
    if (state_ != LinkState::Searching) toSearching(now);
    return;
  }
  readUdp(now);

  switch (state_) {
    case LinkState::Searching:
      search(now);
      break;
    case LinkState::Connecting: {
      TcpState t = net_.tcpState();
      if (t == TcpState::Open) {
        state_ = LinkState::Connected;
        stats_.connects++;
        lastStateAt_ = now;  // give the server a moment to send the first state
        deframer_.clear();
        sendTcp(encodeHello(nextSeq('H'), now, set_.fw, set_.plan, set_.board));
        sendPendingQuakes(now);
      } else if (t == TcpState::Closed || now - connectStart_ > set_.connectTimeoutMs) {
        toSearching(now);
      }
      break;
    }
    case LinkState::Connected:
      readTcp(now);
      if (state_ != LinkState::Connected) break;
      if (net_.tcpState() != TcpState::Open || now - lastStateAt_ > set_.noStateMs) {
        toSearching(now);
        break;
      }
      for (auto& q : quakes_) {
        if (now - q.sentAt >= set_.resendMs) {
          q.sentAt = now;
          stats_.resends++;
          sendTcp(q.body);  // same seq: the server uses it once
        }
      }
      break;
  }
}

// --- search and connect --------------------------------------------------------

void Link::toSearching(uint32_t now) {
  net_.tcpClose();
  deframer_.clear();
  state_ = LinkState::Searching;
  searchStart_ = now;
  helloSent_ = false;
  stats_.searches++;
}

void Link::search(uint32_t now) {
  if (helloSent_ && now - lastHello_ < set_.helloEveryMs) return;
  helloSent_ = true;
  lastHello_ = now;
  auto hello = encodeHello(nextSeq('H'), now, set_.fw, set_.plan, set_.board);
  net_.udpBroadcast(set_.port, hello.data(), hello.size());
  if (now - searchStart_ >= set_.backupAfterMs && !set_.backupHost.empty()) {
    net_.udpSendTo(set_.backupHost, set_.port, hello.data(), hello.size());
  }
}

// --- in ------------------------------------------------------------------------

void Link::readUdp(uint32_t now) {
  uint8_t buf[kUdpMax];
  std::string from;
  for (int k = 0; k < kMaxUdpPerPoll; ++k) {
    size_t n = net_.udpReceive(buf, sizeof buf, from);
    if (n == 0) break;
    onUdp(std::vector<uint8_t>(buf, buf + n), from, now);
  }
}

void Link::readTcp(uint32_t now) {
  uint8_t buf[512];
  for (;;) {
    size_t n = net_.tcpReceive(buf, sizeof buf);
    if (n == 0) break;
    if (!deframer_.push(buf, n)) {  // a length we cannot hold: the channel is broken
      stats_.badMessages++;
      toSearching(now);
      return;
    }
  }
  std::vector<uint8_t> msg;
  while (state_ == LinkState::Connected && deframer_.next(msg)) onTcp(msg, now);
}

void Link::checkSid(const Frame& f) {
  if (!f.hasSid) return;
  if (haveSid_ && f.sid == sid_) return;
  if (haveSid_) stats_.sidChanges++;
  haveSid_ = true;
  sid_ = f.sid;
  lastIn_.clear();  // a new server session: its order numbers start again
}

bool Link::isNew(const char* key, uint32_t seq) {
  auto it = lastIn_.find(key);
  if (it != lastIn_.end() && seq <= it->second) return false;
  lastIn_[key] = seq;
  return true;
}

void Link::onUdp(const std::vector<uint8_t>& bytes, const std::string& from, uint32_t now) {
  Frame f;
  if (decodeFrame(bytes.data(), bytes.size(), f) != DecodeError::None) {
    stats_.badMessages++;
    return;
  }
  if (state_ == LinkState::Searching) {
    // The answer to the search is a delay probe from the server.
    if (f.t == 'P') {
      checkSid(f);
      server_ = from;
      state_ = LinkState::Connecting;
      connectStart_ = now;
      net_.tcpConnect(server_, set_.port);
    }
    return;
  }
  if (from != server_) return;  // not our server
  checkSid(f);
  switch (f.t) {
    case 'S': {
      if (!isNew("uS", f.seq)) {
        stats_.lateDropped++;
        return;
      }
      BoardState s;
      if (!readState(f.d, s)) {
        stats_.badMessages++;
        return;
      }
      s.seq = f.seq;
      s.receivedMs = now;
      latest_ = std::move(s);
      stateVersion_++;
      stats_.statesTaken++;
      lastStateAt_ = now;
      return;
    }
    case 'P': {
      if (!isNew("uP", f.seq)) {
        stats_.lateDropped++;
        return;
      }
      if (state_ != LinkState::Connected) return;
      // Answer at once, with the age of the state we use.
      uint32_t age = hasState() ? now - latest_.receivedMs : 0;
      auto pong = encodePong(f.seq, now, f.ts, hasState() ? latest_.seq : 0, age);
      net_.udpSendTo(server_, set_.port, pong.data(), pong.size());
      return;
    }
    default:
      stats_.badMessages++;
  }
}

void Link::onTcp(const std::vector<uint8_t>& bytes, uint32_t now) {
  Frame f;
  if (decodeFrame(bytes.data(), bytes.size(), f) != DecodeError::None) {
    stats_.badMessages++;
    return;
  }
  checkSid(f);
  switch (f.t) {
    case 'C': {
      if (f.ack) sendTcp(encodeAnswer(f.seq, now, 'C'));
      if (!isNew("tC", f.seq)) return;  // sent again: answered, used once
      BoardConfig c;
      if (!readConfig(f.d, c)) {
        stats_.badMessages++;
        return;
      }
      config_ = std::move(c);
      configVersion_++;
      return;
    }
    case 'V': {
      if (f.ack) sendTcp(encodeAnswer(f.seq, now, 'V'));
      if (!isNew("tV", f.seq)) return;
      VibrateCmd v;
      if (!readVibrate(f.d, v)) {
        stats_.badMessages++;
        return;
      }
      if (vibrates_.size() >= kMaxVibrates) vibrates_.pop_front();
      vibrates_.push_back(v);
      return;
    }
    case 'A': {
      const mp::Value* of = f.d.get("of");
      if (of && !(of->type == mp::Type::Str && of->s == "Q")) return;  // only Q waits for an answer
      for (auto it = quakes_.begin(); it != quakes_.end(); ++it) {
        if (it->seq == f.seq) {
          quakes_.erase(it);
          break;
        }
      }
      return;
    }
    default:
      stats_.badMessages++;
  }
}

// --- out -----------------------------------------------------------------------

uint32_t Link::nextSeq(char t) { return ++seqOut_[t]; }

void Link::sendTcp(const std::vector<uint8_t>& body) {
  if (net_.tcpState() != TcpState::Open) return;
  auto framed = frameTcp(body);
  net_.tcpSend(framed.data(), framed.size());
}

void Link::sendPendingQuakes(uint32_t now) {
  for (auto& q : quakes_) {
    q.sentAt = now;
    sendTcp(q.body);
  }
}

bool Link::takeVibrate(VibrateCmd& out) {
  if (vibrates_.empty()) return false;
  out = vibrates_.front();
  vibrates_.pop_front();
  return true;
}

void Link::sendQuake(const QuakeOut& q) {
  uint32_t seq = nextSeq('Q');
  if (quakes_.size() >= kMaxQuakes) quakes_.pop_front();
  quakes_.push_back({seq, encodeQuake(seq, now_, q), now_});
  if (state_ == LinkState::Connected) sendTcp(quakes_.back().body);
}

void Link::sendSensor(uint16_t hz, const float* a, size_t n) {
  if (state_ != LinkState::Connected) return;
  auto b = encodeSensor(nextSeq('N'), now_, hz, a, n);
  net_.udpSendTo(server_, set_.port, b.data(), b.size());
}

void Link::sendStatus(const StatusOut& s) {
  if (state_ != LinkState::Connected) return;
  sendTcp(encodeStatus(nextSeq('T'), now_, s, set_.plan, hasState() ? latest_.seq : 0));
}

}  // namespace boardlink
