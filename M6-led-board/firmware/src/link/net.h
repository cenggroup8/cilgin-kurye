// The network as the link part sees it (M6-1). On the ESP32 this is Wi-Fi
// (net_arduino.cpp); in the PC tests it is a fake network or real sockets.
// Nothing here may wait: every call returns at once (plan #28, section 3.1).
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

namespace boardlink {

enum class TcpState : uint8_t { Closed, Connecting, Open };

class Net {
 public:
  virtual ~Net() = default;

  /** Wi-Fi is up and has an address. */
  virtual bool ready() = 0;

  virtual void udpSendTo(const std::string& host, uint16_t port, const uint8_t* data, size_t len) = 0;
  /** To every computer on the local network. */
  virtual void udpBroadcast(uint16_t port, const uint8_t* data, size_t len) = 0;
  /** The next UDP packet, or 0 when there is none. */
  virtual size_t udpReceive(uint8_t* buf, size_t cap, std::string& fromHost) = 0;

  /** Starts a connection; tcpState() tells when it is open. */
  virtual void tcpConnect(const std::string& host, uint16_t port) = 0;
  virtual TcpState tcpState() = 0;
  /** False when the bytes could not be handed to the network. */
  virtual bool tcpSend(const uint8_t* data, size_t len) = 0;
  /** Bytes that arrived, or 0. */
  virtual size_t tcpReceive(uint8_t* buf, size_t cap) = 0;
  virtual void tcpClose() = 0;
};

}  // namespace boardlink
