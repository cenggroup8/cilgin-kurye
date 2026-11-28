#include "protocol.h"

#include <cmath>

namespace boardlink {

namespace {

bool isUint32(const mp::Value* v) {
  return v && v->type == mp::Type::Int && v->i >= 0 && v->i <= 0xffffffffLL;
}

bool num(const mp::Value* v, double lo, double hi, double& out) {
  if (!v || !v->isNum()) return false;
  double x = v->num();
  if (!std::isfinite(x) || x < lo || x > hi) return false;
  out = x;
  return true;
}

bool whole(const mp::Value* v, int64_t lo, int64_t hi, int64_t& out) {
  if (!v || v->type != mp::Type::Int || v->i < lo || v->i > hi) return false;
  out = v->i;
  return true;
}

/** A list of `n` numbers. */
bool numList(const mp::Value& v, size_t n, double* out) {
  if (v.type != mp::Type::Arr || v.arr.size() != n) return false;
  for (size_t k = 0; k < n; ++k) {
    if (!v.arr[k].isNum() || !std::isfinite(v.arr[k].num())) return false;
    out[k] = v.arr[k].num();
  }
  return true;
}

bool in(double x, double lo, double hi) { return x >= lo && x <= hi; }
bool isWhole(double x) { return std::floor(x) == x; }

mp::Value frameHead(char t, uint32_t seq, uint32_t ts) {
  mp::Value m = mp::Value::object();
  m.set("t", mp::Value::str(std::string(1, t)));
  m.set("v", mp::Value::integer(kProtocolVersion));
  m.set("seq", mp::Value::integer(seq));
  m.set("ts", mp::Value::integer(ts));
  return m;
}

std::vector<uint8_t> bytes(const mp::Value& v) {
  std::vector<uint8_t> out;
  mp::encode(v, out);
  return out;
}

}  // namespace

DecodeError decodeFrame(const uint8_t* data, size_t len, Frame& out) {
  mp::Value v;
  if (!mp::decode(data, len, v)) return DecodeError::NotMsgpack;
  if (v.type != mp::Type::Map) return DecodeError::NotAMap;
  const mp::Value* t = v.get("t");
  if (!t || t->type != mp::Type::Str || t->s.size() != 1) return DecodeError::BadType;
  const char c = t->s[0];
  if (std::string("SCVPOHQNTA").find(c) == std::string::npos) return DecodeError::BadType;
  const mp::Value* ver = v.get("v");
  if (!ver || ver->type != mp::Type::Int || ver->i != kProtocolVersion) return DecodeError::BadVersion;
  const mp::Value* seq = v.get("seq");
  const mp::Value* ts = v.get("ts");
  const mp::Value* sid = v.get("sid");
  const mp::Value* ack = v.get("ack");
  const mp::Value* d = v.get("d");
  if (!isUint32(seq) || !isUint32(ts) || !d || d->type != mp::Type::Map) return DecodeError::BadField;
  if (sid && !isUint32(sid)) return DecodeError::BadField;
  if (ack && !(ack->type == mp::Type::Bool && ack->b)) return DecodeError::BadField;
  out.t = c;
  out.seq = static_cast<uint32_t>(seq->i);
  out.ts = static_cast<uint32_t>(ts->i);
  out.hasSid = sid != nullptr;
  out.sid = sid ? static_cast<uint32_t>(sid->i) : 0;
  out.ack = ack != nullptr;
  out.d = *d;
  return DecodeError::None;
}

bool readState(const mp::Value& d, BoardState& out) {
  BoardState s;
  int64_t ph, tl;
  if (!whole(d.get("ph"), 0, 4, ph) || !whole(d.get("tl"), 0, 65535, tl)) return false;
  s.phase = static_cast<uint8_t>(ph);
  s.timeLeft = static_cast<uint16_t>(tl);

  const mp::Value* p = d.get("p");
  const mp::Value* dp = d.get("dp");
  const mp::Value* ob = d.get("ob");
  const mp::Value* eq = d.get("eq");
  if (!p || p->type != mp::Type::Arr || p->arr.size() > 8) return false;
  if (!dp || dp->type != mp::Type::Arr || dp->arr.size() > 8) return false;
  if (!ob || ob->type != mp::Type::Arr || ob->arr.size() > 240) return false;
  if (!eq || eq->type != mp::Type::Arr) return false;

  for (const auto& item : p->arr) {
    double x[8];
    if (!numList(item, 8, x)) return false;
    if (!in(x[0], 0, 7) || !in(x[1], 0, 3) || !in(x[2], 0, 1) || !in(x[3], 0, 255)) return false;
    if (!isWhole(x[0]) || !isWhole(x[1]) || !isWhole(x[2]) || !isWhole(x[3])) return false;
    if (!in(x[4], 0, 1) || !in(x[5], 0, 1) || !in(x[6], 0, 360) || !in(x[7], -100, 100)) return false;
    Player pl;
    pl.id = static_cast<uint8_t>(x[0]);
    pl.team = static_cast<uint8_t>(x[1]);
    pl.tone = static_cast<uint8_t>(x[2]);
    pl.flags = static_cast<uint8_t>(x[3]);
    pl.u = static_cast<float>(x[4]);
    pl.v = static_cast<float>(x[5]);
    pl.heading = static_cast<float>(x[6]);
    pl.speed = static_cast<float>(x[7]);
    s.players.push_back(pl);
  }
  for (const auto& item : dp->arr) {
    double x[4];
    if (!numList(item, 4, x)) return false;
    if (!in(x[0], 0, 7) || !isWhole(x[0]) || !in(x[1], 0, 1) || !in(x[2], 0, 1) || !in(x[3], 0, 1)) return false;
    s.points.push_back({static_cast<uint8_t>(x[0]), static_cast<float>(x[1]), static_cast<float>(x[2]), static_cast<uint8_t>(x[3])});
  }
  for (const auto& item : ob->arr) {
    double x[3];
    if (!numList(item, 3, x)) return false;
    if (!in(x[0], 0, 59) || !in(x[1], 1, 4) || !in(x[2], 0, 255) || !isWhole(x[0]) || !isWhole(x[1]) || !isWhole(x[2])) return false;
    s.obstacles.push_back({static_cast<uint8_t>(x[0]), static_cast<uint8_t>(x[1]), static_cast<uint8_t>(x[2])});
  }
  if (!eq->arr.empty()) {  // an empty list: no earthquake
    double x[5];
    if (!numList(*eq, 5, x)) return false;
    if (!in(x[0], 0, 1) || !in(x[1], 0, 1) || !in(x[2], 0, 1) || !in(x[3], 0, 10) || !in(x[4], 0, 4294967295.0)) return false;
    s.quake = {x[0] >= 0.5, static_cast<float>(x[1]), static_cast<float>(x[2]), static_cast<float>(x[3]), static_cast<uint32_t>(x[4])};
  }
  out = std::move(s);
  return true;
}

bool readConfig(const mp::Value& d, BoardConfig& out) {
  BoardConfig c;
  const mp::Value* plan = d.get("plan");
  double bright, maxMa;
  if (!plan || plan->type != mp::Type::Str) return false;
  if (!num(d.get("bright"), 0.1, 1.0, bright) || !num(d.get("max_ma"), 0, 65535, maxMa)) return false;
  c.plan = plan->s;
  c.bright = static_cast<float>(bright);
  c.maxMa = static_cast<uint16_t>(maxMa);
  const mp::Value* tones = d.get("tones");
  if (!tones || tones->type != mp::Type::Arr || tones->arr.size() != 8) return false;
  for (size_t k = 0; k < 8; ++k) {
    double x[3];
    if (!numList(tones->arr[k], 3, x)) return false;
    for (double y : x)
      if (!in(y, 0, 255) || !isWhole(y)) return false;
    c.tones[k] = {static_cast<uint8_t>(x[0]), static_cast<uint8_t>(x[1]), static_cast<uint8_t>(x[2])};
  }
  const mp::Value* anim = d.get("anim");
  if (anim) {  // optional: the LED part keeps its defaults
    double tail, hz;
    if (anim->type != mp::Type::Map || !num(anim->get("tail"), 0, 20, tail) || !num(anim->get("dp_blink_hz"), 0, 20, hz)) return false;
    c.tail = static_cast<uint8_t>(tail);
    c.dpBlinkHz = static_cast<float>(hz);
  }
  out = std::move(c);
  return true;
}

bool readVibrate(const mp::Value& d, VibrateCmd& out) {
  double mask, duty, ms, ramp;
  if (!num(d.get("mask"), 0, 15, mask) || !isWhole(mask) || !num(d.get("duty"), 0, 1, duty)) return false;
  if (!num(d.get("ms"), 0, 60000, ms) || !num(d.get("ramp_ms"), 0, 60000, ramp)) return false;
  out = {static_cast<uint8_t>(mask), static_cast<float>(duty), static_cast<uint16_t>(ms), static_cast<uint16_t>(ramp)};
  return true;
}

std::vector<uint8_t> encodeHello(uint32_t seq, uint32_t ts, const std::string& fw, const std::string& plan, const std::string& board) {
  mp::Value m = frameHead('H', seq, ts);
  mp::Value d = mp::Value::object();
  d.set("fw", mp::Value::str(fw)).set("plan", mp::Value::str(plan)).set("board", mp::Value::str(board));
  m.set("d", std::move(d));
  return bytes(m);
}

std::vector<uint8_t> encodeQuake(uint32_t seq, uint32_t ts, const QuakeOut& q) {
  mp::Value m = frameHead('Q', seq, ts);
  m.set("ack", mp::Value::boolean(true));
  mp::Value d = mp::Value::object();
  d.set("id", mp::Value::integer(q.id))
      .set("src", mp::Value::str(q.motor ? "motor" : "hit"))
      .set("peak_g", mp::Value::real(q.peakG))
      .set("mag", mp::Value::real(q.mag))
      .set("u", mp::Value::real(q.u))
      .set("v", mp::Value::real(q.v))
      .set("zone", mp::Value::integer(q.zone))
      .set("conf", mp::Value::real(q.conf));
  m.set("d", std::move(d));
  return bytes(m);
}

std::vector<uint8_t> encodeSensor(uint32_t seq, uint32_t ts, uint16_t hz, const float* a, size_t n) {
  mp::Value m = frameHead('N', seq, ts);
  mp::Value list = mp::Value::array();
  for (size_t k = 0; k < n; ++k) list.push(mp::Value::real(a[k]));
  mp::Value d = mp::Value::object();
  d.set("hz", mp::Value::integer(hz)).set("a", std::move(list));
  m.set("d", std::move(d));
  return bytes(m);
}

std::vector<uint8_t> encodeStatus(uint32_t seq, uint32_t ts, const StatusOut& s, const std::string& plan, uint32_t lastSeq) {
  mp::Value m = frameHead('T', seq, ts);
  mp::Value err = mp::Value::array();
  for (const auto& e : s.err) err.push(mp::Value::str(e));
  mp::Value d = mp::Value::object();
  d.set("fw", mp::Value::str(s.fw))
      .set("plan", mp::Value::str(plan))
      .set("last_seq", mp::Value::integer(lastSeq))
      .set("fps", mp::Value::integer(s.fps))
      .set("rssi", mp::Value::integer(s.rssi))
      .set("ma_est", mp::Value::integer(s.maEst))
      .set("heap", mp::Value::integer(s.heap))
      .set("err", std::move(err));
  m.set("d", std::move(d));
  return bytes(m);
}

std::vector<uint8_t> encodePong(uint32_t probeSeq, uint32_t ts, uint32_t pingTs, uint32_t stateSeq, uint32_t stateAgeMs) {
  mp::Value m = frameHead('O', probeSeq, ts);
  mp::Value d = mp::Value::object();
  d.set("ping_ts", mp::Value::integer(pingTs))
      .set("state_seq", mp::Value::integer(stateSeq))
      .set("state_age_ms", mp::Value::integer(stateAgeMs));
  m.set("d", std::move(d));
  return bytes(m);
}

std::vector<uint8_t> encodeAnswer(uint32_t seq, uint32_t ts, char of) {
  mp::Value m = frameHead('A', seq, ts);
  mp::Value d = mp::Value::object();
  d.set("of", mp::Value::str(std::string(1, of)));
  m.set("d", std::move(d));
  return bytes(m);
}

std::vector<uint8_t> frameTcp(const std::vector<uint8_t>& body) {
  std::vector<uint8_t> out;
  out.reserve(body.size() + 2);
  out.push_back(static_cast<uint8_t>(body.size() >> 8));
  out.push_back(static_cast<uint8_t>(body.size()));
  out.insert(out.end(), body.begin(), body.end());
  return out;
}

bool Deframer::push(const uint8_t* data, size_t len) {
  buf_.insert(buf_.end(), data, data + len);
  if (buf_.size() >= 2) {
    size_t want = (static_cast<size_t>(buf_[0]) << 8) | buf_[1];
    if (want > kMaxFrame) return false;
  }
  return true;
}

bool Deframer::next(std::vector<uint8_t>& msg) {
  if (buf_.size() < 2) return false;
  size_t want = (static_cast<size_t>(buf_[0]) << 8) | buf_[1];
  if (want > kMaxFrame || buf_.size() < 2 + want) return false;
  msg.assign(buf_.begin() + 2, buf_.begin() + 2 + static_cast<long>(want));
  buf_.erase(buf_.begin(), buf_.begin() + 2 + static_cast<long>(want));
  return true;
}

}  // namespace boardlink
