// Wi-Fi network for the ESP32 (M6-1). Only built for the board.
#pragma once
#ifdef ARDUINO
#include <WiFi.h>
#include <WiFiUdp.h>

#include "net.h"

namespace boardlink {

class ArduinoNet : public Net {
 public:
  /** `localUdpPort`: the board's own UDP port; the server answers there. */
  explicit ArduinoNet(uint16_t localUdpPort = 47101) : localPort_(localUdpPort) {}

  bool ready() override {
    bool up = WiFi.status() == WL_CONNECTED;
    if (up && !udpOpen_) udpOpen_ = udp_.begin(localPort_) == 1;
    if (!up && udpOpen_) {
      udp_.stop();
      udpOpen_ = false;
    }
    return up && udpOpen_;
  }

  void udpSendTo(const std::string& host, uint16_t port, const uint8_t* data, size_t len) override {
    IPAddress ip;
    if (!ip.fromString(host.c_str())) return;
    udp_.beginPacket(ip, port);
    udp_.write(data, len);
    udp_.endPacket();
  }

  void udpBroadcast(uint16_t port, const uint8_t* data, size_t len) override {
    udp_.beginPacket(WiFi.broadcastIP(), port);
    udp_.write(data, len);
    udp_.endPacket();
  }

  size_t udpReceive(uint8_t* buf, size_t cap, std::string& fromHost) override {
    int n = udp_.parsePacket();
    if (n <= 0) return 0;
    fromHost = udp_.remoteIP().toString().c_str();
    if (static_cast<size_t>(n) > cap) {  // too big for us: drop it
      udp_.flush();
      return 0;
    }
    return static_cast<size_t>(udp_.read(buf, cap));
  }

  void tcpConnect(const std::string& host, uint16_t port) override {
    // WiFiClient::connect waits until it is open or the time is up. It runs only
    // while searching, when the LEDs show "searching" anyway, so the wait is short.
    open_ = tcp_.connect(host.c_str(), port, kConnectWaitMs) == 1;
    if (open_) tcp_.setNoDelay(true);  // small messages go at once
  }

  TcpState tcpState() override {
    if (open_ && !tcp_.connected()) open_ = false;
    return open_ ? TcpState::Open : TcpState::Closed;
  }

  bool tcpSend(const uint8_t* data, size_t len) override { return open_ && tcp_.write(data, len) == len; }

  size_t tcpReceive(uint8_t* buf, size_t cap) override {
    if (!open_) return 0;
    int a = tcp_.available();
    if (a <= 0) return 0;
    int n = tcp_.read(buf, a < static_cast<int>(cap) ? a : static_cast<int>(cap));
    return n > 0 ? static_cast<size_t>(n) : 0;
  }

  void tcpClose() override {
    tcp_.stop();
    open_ = false;
  }

 private:
  static constexpr int kConnectWaitMs = 300;
  uint16_t localPort_;
  WiFiUDP udp_;
  WiFiClient tcp_;
  bool udpOpen_ = false;
  bool open_ = false;
};

}  // namespace boardlink
#endif
