// Link part of the board program (M6-1): finds the server, keeps one TCP
// channel and one UDP stream, and hands the newest full state and the config
// to the LED part. Protocol: contracts/board_protocol.md.
//
// poll() is step 1 of the main loop. It reads everything that arrived, answers
// at once where the protocol asks for it, and never waits.
#pragma once
#include <cstdint>
#include <deque>
#include <map>
#include <string>
#include <vector>

#include "link_types.h"
#include "net.h"
#include "protocol.h"

namespace boardlink {

struct LinkSettings {
  /** Server address saved in flash, used when the search finds nothing. */
  std::string backupHost;
  /** TCP and UDP port of the server (a setting, not fixed in the protocol). */
  uint16_t port = 47100;
  std::string fw = "0.1.0";
  std::string plan = "0.2.0";
  std::string board = "board-01";
  uint32_t helloEveryMs = 1000;     // search: one Hello per second
  uint32_t backupAfterMs = 5000;    // no answer to the search: try the backup address too
  uint32_t connectTimeoutMs = 3000;
  uint32_t noStateMs = 1000;        // no board state this long: search again, motors stop
  uint32_t resendMs = 1000;         // earthquake event without an answer: send again
};

struct LinkStats {
  uint32_t badMessages = 0;
  uint32_t lateDropped = 0;   // UDP packets with an old order number
  uint32_t statesTaken = 0;
  uint32_t sidChanges = 0;
  uint32_t searches = 0;
  uint32_t connects = 0;
  uint32_t resends = 0;
};

class Link {
 public:
  Link(Net& net, LinkSettings settings);

  void poll(uint32_t nowMs);

  // --- to the LED part and to M6-2 (plan 3.2) ---
  LinkState linkState() const { return state_; }
  bool hasState() const { return stateVersion_ > 0; }
  /** The newest full state. Read it when stateVersion() changed. */
  const BoardState& latestState() const { return latest_; }
  uint32_t stateVersion() const { return stateVersion_; }
  bool hasConfig() const { return configVersion_ > 0; }
  const BoardConfig& config() const { return config_; }
  uint32_t configVersion() const { return configVersion_; }
  /** Next vibrate command for the motor controller. */
  bool takeVibrate(VibrateCmd& out);

  // --- from the board parts ---
  /** Earthquake event from M6-2. Sent on TCP and again until the server answers. */
  void sendQuake(const QuakeOut& q);
  /** Sensor samples for the seismic graph (UDP, may be lost). */
  void sendSensor(uint16_t hz, const float* a, size_t n);
  /** Status report, once per second (TCP). */
  void sendStatus(const StatusOut& s);

  const LinkStats& stats() const { return stats_; }

 private:
  void search(uint32_t now);
  void toSearching(uint32_t now);
  void readUdp(uint32_t now);
  void readTcp(uint32_t now);
  void onUdp(const std::vector<uint8_t>& bytes, const std::string& from, uint32_t now);
  void onTcp(const std::vector<uint8_t>& bytes, uint32_t now);
  void checkSid(const Frame& f);
  bool isNew(const char* key, uint32_t seq);
  uint32_t nextSeq(char t);
  void sendTcp(const std::vector<uint8_t>& body);
  void sendPendingQuakes(uint32_t now);

  Net& net_;
  LinkSettings set_;
  LinkState state_ = LinkState::Searching;
  LinkStats stats_;

  std::string server_;
  uint32_t searchStart_ = 0;
  uint32_t lastHello_ = 0;
  bool helloSent_ = false;
  uint32_t connectStart_ = 0;
  uint32_t lastStateAt_ = 0;
  uint32_t now_ = 0;

  bool haveSid_ = false;
  uint32_t sid_ = 0;
  std::map<std::string, uint32_t> lastIn_;
  std::map<char, uint32_t> seqOut_;

  Deframer deframer_;
  BoardState latest_;
  uint32_t stateVersion_ = 0;
  BoardConfig config_;
  uint32_t configVersion_ = 0;
  std::deque<VibrateCmd> vibrates_;

  struct PendingQuake {
    uint32_t seq;
    std::vector<uint8_t> body;
    uint32_t sentAt;
  };
  std::deque<PendingQuake> quakes_;
};

}  // namespace boardlink
