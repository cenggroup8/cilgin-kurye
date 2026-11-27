// Small MessagePack reader and writer for the board protocol (M6-1).
// Plain C++17, no Arduino headers, so the PC tests use the same code.
//
// Writing follows the server (M2) so the bytes are the same as in
// contracts/board_protocol_vectors.json: integers in the smallest form,
// every float as float32, maps keep the order of their keys.
// Reading never trusts the input: every length is checked, nesting is limited,
// and the whole buffer must be one value.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace mp {

enum class Type : uint8_t { Nil, Bool, Int, Float, Str, Arr, Map };

struct Value {
  Type type = Type::Nil;
  bool b = false;
  int64_t i = 0;
  double f = 0;
  std::string s;
  std::vector<Value> arr;
  std::vector<std::pair<std::string, Value>> map;

  static Value nil() { return Value(); }
  static Value boolean(bool x) { Value v; v.type = Type::Bool; v.b = x; return v; }
  static Value integer(int64_t x) { Value v; v.type = Type::Int; v.i = x; return v; }
  static Value real(double x) { Value v; v.type = Type::Float; v.f = x; return v; }
  static Value str(std::string x) { Value v; v.type = Type::Str; v.s = std::move(x); return v; }
  static Value array() { Value v; v.type = Type::Arr; return v; }
  static Value object() { Value v; v.type = Type::Map; return v; }

  /** Adds a key to a map (keeps the order) and returns this map. */
  Value& set(const char* key, Value v) {
    map.emplace_back(key, std::move(v));
    return *this;
  }
  Value& push(Value v) {
    arr.push_back(std::move(v));
    return *this;
  }

  /** Field of a map, or nullptr. */
  const Value* get(const char* key) const;
  /** A number: an integer or a float. A whole number is accepted where a float is expected. */
  bool isNum() const { return type == Type::Int || type == Type::Float; }
  double num() const { return type == Type::Int ? static_cast<double>(i) : f; }
};

/** Appends the bytes of `v` to `out`. */
void encode(const Value& v, std::vector<uint8_t>& out);

/** Reads exactly one value from the buffer. False for anything broken. */
bool decode(const uint8_t* data, size_t len, Value& out);

}  // namespace mp
