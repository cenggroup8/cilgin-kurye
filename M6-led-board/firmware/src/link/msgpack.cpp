#include "msgpack.h"

#include <cstring>

namespace mp {

const Value* Value::get(const char* key) const {
  if (type != Type::Map) return nullptr;
  for (const auto& kv : map)
    if (kv.first == key) return &kv.second;
  return nullptr;
}

// --- writing -----------------------------------------------------------------

namespace {

void put8(std::vector<uint8_t>& o, uint8_t b) { o.push_back(b); }

void putBE(std::vector<uint8_t>& o, uint64_t x, int bytes) {
  for (int k = bytes - 1; k >= 0; --k) o.push_back(static_cast<uint8_t>(x >> (8 * k)));
}

void putInt(std::vector<uint8_t>& o, int64_t x) {
  if (x >= 0) {
    uint64_t u = static_cast<uint64_t>(x);
    if (u < 0x80) put8(o, static_cast<uint8_t>(u));
    else if (u <= 0xff) { put8(o, 0xcc); putBE(o, u, 1); }
    else if (u <= 0xffff) { put8(o, 0xcd); putBE(o, u, 2); }
    else if (u <= 0xffffffffULL) { put8(o, 0xce); putBE(o, u, 4); }
    else { put8(o, 0xcf); putBE(o, u, 8); }
  } else {
    if (x >= -32) put8(o, static_cast<uint8_t>(x));
    else if (x >= -128) { put8(o, 0xd0); putBE(o, static_cast<uint8_t>(x), 1); }
    else if (x >= -32768) { put8(o, 0xd1); putBE(o, static_cast<uint16_t>(x), 2); }
    else if (x >= -2147483648LL) { put8(o, 0xd2); putBE(o, static_cast<uint32_t>(x), 4); }
    else { put8(o, 0xd3); putBE(o, static_cast<uint64_t>(x), 8); }
  }
}

void putStr(std::vector<uint8_t>& o, const std::string& s) {
  size_t n = s.size();
  if (n < 32) put8(o, static_cast<uint8_t>(0xa0 | n));
  else if (n <= 0xff) { put8(o, 0xd9); putBE(o, n, 1); }
  else if (n <= 0xffff) { put8(o, 0xda); putBE(o, n, 2); }
  else { put8(o, 0xdb); putBE(o, n, 4); }
  o.insert(o.end(), s.begin(), s.end());
}

void putLen(std::vector<uint8_t>& o, size_t n, uint8_t fix, uint8_t m16, uint8_t m32) {
  if (n < 16) put8(o, static_cast<uint8_t>(fix | n));
  else if (n <= 0xffff) { put8(o, m16); putBE(o, n, 2); }
  else { put8(o, m32); putBE(o, n, 4); }
}

}  // namespace

void encode(const Value& v, std::vector<uint8_t>& o) {
  switch (v.type) {
    case Type::Nil: put8(o, 0xc0); break;
    case Type::Bool: put8(o, v.b ? 0xc3 : 0xc2); break;
    case Type::Int: putInt(o, v.i); break;
    case Type::Float: {
      float f = static_cast<float>(v.f);
      uint32_t bits;
      std::memcpy(&bits, &f, 4);
      put8(o, 0xca);
      putBE(o, bits, 4);
      break;
    }
    case Type::Str: putStr(o, v.s); break;
    case Type::Arr:
      putLen(o, v.arr.size(), 0x90, 0xdc, 0xdd);
      for (const auto& x : v.arr) encode(x, o);
      break;
    case Type::Map:
      putLen(o, v.map.size(), 0x80, 0xde, 0xdf);
      for (const auto& kv : v.map) {
        putStr(o, kv.first);
        encode(kv.second, o);
      }
      break;
  }
}

// --- reading -----------------------------------------------------------------

namespace {

constexpr int kMaxDepth = 8;
constexpr uint32_t kMaxItems = 4096;

struct Reader {
  const uint8_t* p;
  const uint8_t* end;

  bool need(size_t n) const { return static_cast<size_t>(end - p) >= n; }

  bool be(int bytes, uint64_t& x) {
    if (!need(bytes)) return false;
    x = 0;
    for (int k = 0; k < bytes; ++k) x = (x << 8) | *p++;
    return true;
  }

  bool str(size_t n, std::string& s) {
    if (!need(n)) return false;
    s.assign(reinterpret_cast<const char*>(p), n);
    p += n;
    return true;
  }

  bool value(Value& v, int depth) {
    if (depth > kMaxDepth || !need(1)) return false;
    uint8_t c = *p++;
    uint64_t x = 0;
    if (c <= 0x7f) { v = Value::integer(c); return true; }
    if (c >= 0xe0) { v = Value::integer(static_cast<int8_t>(c)); return true; }
    if ((c & 0xe0) == 0xa0) { v.type = Type::Str; return str(c & 0x1f, v.s); }
    if ((c & 0xf0) == 0x90) return array(v, c & 0x0f, depth);
    if ((c & 0xf0) == 0x80) return object(v, c & 0x0f, depth);
    switch (c) {
      case 0xc0: v = Value::nil(); return true;
      case 0xc2: v = Value::boolean(false); return true;
      case 0xc3: v = Value::boolean(true); return true;
      case 0xcc: if (!be(1, x)) return false; v = Value::integer(static_cast<int64_t>(x)); return true;
      case 0xcd: if (!be(2, x)) return false; v = Value::integer(static_cast<int64_t>(x)); return true;
      case 0xce: if (!be(4, x)) return false; v = Value::integer(static_cast<int64_t>(x)); return true;
      case 0xcf: if (!be(8, x) || x > static_cast<uint64_t>(INT64_MAX)) return false; v = Value::integer(static_cast<int64_t>(x)); return true;
      case 0xd0: if (!be(1, x)) return false; v = Value::integer(static_cast<int8_t>(x)); return true;
      case 0xd1: if (!be(2, x)) return false; v = Value::integer(static_cast<int16_t>(x)); return true;
      case 0xd2: if (!be(4, x)) return false; v = Value::integer(static_cast<int32_t>(x)); return true;
      case 0xd3: if (!be(8, x)) return false; v = Value::integer(static_cast<int64_t>(x)); return true;
      case 0xca: {
        if (!be(4, x)) return false;
        uint32_t bits = static_cast<uint32_t>(x);
        float f;
        std::memcpy(&f, &bits, 4);
        v = Value::real(f);
        return true;
      }
      case 0xcb: {
        if (!be(8, x)) return false;
        double d;
        std::memcpy(&d, &x, 8);
        v = Value::real(d);
        return true;
      }
      case 0xd9: if (!be(1, x)) return false; v.type = Type::Str; return str(x, v.s);
      case 0xda: if (!be(2, x)) return false; v.type = Type::Str; return str(x, v.s);
      case 0xdb: if (!be(4, x)) return false; v.type = Type::Str; return str(x, v.s);
      case 0xdc: if (!be(2, x)) return false; return array(v, x, depth);
      case 0xdd: if (!be(4, x)) return false; return array(v, x, depth);
      case 0xde: if (!be(2, x)) return false; return object(v, x, depth);
      case 0xdf: if (!be(4, x)) return false; return object(v, x, depth);
      default: return false;  // bin, ext and the unused byte are not part of the protocol
    }
  }

  bool array(Value& v, uint64_t n, int depth) {
    // every item takes at least one byte, so a count larger than the rest is a lie
    if (n > kMaxItems || !need(n)) return false;
    v = Value::array();
    v.arr.resize(n);
    for (auto& x : v.arr)
      if (!value(x, depth + 1)) return false;
    return true;
  }

  bool object(Value& v, uint64_t n, int depth) {
    if (n > kMaxItems || !need(2 * n)) return false;
    v = Value::object();
    v.map.resize(n);
    for (auto& kv : v.map) {
      Value key;
      if (!value(key, depth + 1) || key.type != Type::Str) return false;
      kv.first = std::move(key.s);
      if (!value(kv.second, depth + 1)) return false;
    }
    return true;
  }
};

}  // namespace

bool decode(const uint8_t* data, size_t len, Value& out) {
  Reader r{data, data + len};
  Value v;
  if (!r.value(v, 0) || r.p != r.end) return false;
  out = std::move(v);
  return true;
}

}  // namespace mp
