// Board protocol messages (M6-1). Field meanings: contracts/board_protocol.md.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "link_types.h"
#include "msgpack.h"

namespace boardlink {

constexpr int kProtocolVersion = 1;

/** The outer fields that every message has (board_protocol.md section 2). */
struct Frame {
  char t = 0;
  uint32_t seq = 0;
  uint32_t ts = 0;
  bool hasSid = false;
  uint32_t sid = 0;
  bool ack = false;
  mp::Value d;  // content, a map
};

enum class DecodeError : uint8_t { None, NotMsgpack, NotAMap, BadType, BadVersion, BadField };

/** Checks the outer fields. A message with another version or a broken frame is refused. */
DecodeError decodeFrame(const uint8_t* data, size_t len, Frame& out);

// Content of the messages from the server. False when a field is missing or out of range.
bool readState(const mp::Value& d, BoardState& out);
bool readConfig(const mp::Value& d, BoardConfig& out);
bool readVibrate(const mp::Value& d, VibrateCmd& out);

// Messages from the board, in the field order of the vectors.
std::vector<uint8_t> encodeHello(uint32_t seq, uint32_t ts, const std::string& fw, const std::string& plan, const std::string& board);
std::vector<uint8_t> encodeQuake(uint32_t seq, uint32_t ts, const QuakeOut& q);
std::vector<uint8_t> encodeSensor(uint32_t seq, uint32_t ts, uint16_t hz, const float* a, size_t n);
std::vector<uint8_t> encodeStatus(uint32_t seq, uint32_t ts, const StatusOut& s, const std::string& plan, uint32_t lastSeq);
std::vector<uint8_t> encodePong(uint32_t probeSeq, uint32_t ts, uint32_t pingTs, uint32_t stateSeq, uint32_t stateAgeMs);
std::vector<uint8_t> encodeAnswer(uint32_t seq, uint32_t ts, char of);

// TCP: each message starts with its length, 2 bytes, high byte first.
constexpr size_t kMaxFrame = 2048;  // larger messages close the channel (the board has little memory)

std::vector<uint8_t> frameTcp(const std::vector<uint8_t>& body);

class Deframer {
 public:
  /** Adds bytes. False when a message is too long: the caller closes the channel. */
  bool push(const uint8_t* data, size_t len);
  /** Takes the next whole message. */
  bool next(std::vector<uint8_t>& msg);
  void clear() { buf_.clear(); }
  size_t pending() const { return buf_.size(); }

 private:
  std::vector<uint8_t> buf_;
};

}  // namespace boardlink
