// Real sockets for the PC (Windows and Linux), so the link part can talk to
// the real server of M2-4 on this computer. Test only; the board uses net_arduino.h.
#pragma once
#include <cstring>
#include <string>

#include "../../src/link/net.h"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
using sock_t = SOCKET;
static inline bool wouldBlock() { return WSAGetLastError() == WSAEWOULDBLOCK; }
static inline void closeSock(sock_t s) { closesocket(s); }
static inline void nonBlocking(sock_t s) {
  u_long on = 1;
  ioctlsocket(s, FIONBIO, &on);
}
#else
#include <arpa/inet.h>
#include <cerrno>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
using sock_t = int;
#define INVALID_SOCKET (-1)
static inline bool wouldBlock() { return errno == EWOULDBLOCK || errno == EAGAIN || errno == EINPROGRESS; }
static inline void closeSock(sock_t s) { close(s); }
static inline void nonBlocking(sock_t s) { fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK); }
#endif

class SocketNet : public boardlink::Net {
 public:
  SocketNet() {
#ifdef _WIN32
    WSADATA w;
    WSAStartup(MAKEWORD(2, 2), &w);
#endif
    udp_ = socket(AF_INET, SOCK_DGRAM, 0);
    int on = 1;
    setsockopt(udp_, SOL_SOCKET, SO_BROADCAST, reinterpret_cast<const char*>(&on), sizeof on);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_ANY);
    bind(udp_, reinterpret_cast<sockaddr*>(&a), sizeof a);
    nonBlocking(udp_);
  }
  ~SocketNet() override {
    tcpClose();
    closeSock(udp_);
  }

  bool ready() override { return true; }

  void udpSendTo(const std::string& host, uint16_t port, const uint8_t* d, size_t n) override {
    sockaddr_in a = addr(host, port);
    sendto(udp_, reinterpret_cast<const char*>(d), static_cast<int>(n), 0, reinterpret_cast<sockaddr*>(&a), sizeof a);
  }
  void udpBroadcast(uint16_t port, const uint8_t* d, size_t n) override { udpSendTo("255.255.255.255", port, d, n); }

  size_t udpReceive(uint8_t* buf, size_t cap, std::string& from) override {
    sockaddr_in a{};
    socklen_t al = sizeof a;
    int n = recvfrom(udp_, reinterpret_cast<char*>(buf), static_cast<int>(cap), 0, reinterpret_cast<sockaddr*>(&a), &al);
    if (n <= 0) return 0;
    char ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &a.sin_addr, ip, sizeof ip);
    from = ip;
    return static_cast<size_t>(n);
  }

  void tcpConnect(const std::string& host, uint16_t port) override {
    tcpClose();
    tcp_ = socket(AF_INET, SOCK_STREAM, 0);
    int on = 1;
    setsockopt(tcp_, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&on), sizeof on);
    nonBlocking(tcp_);
    sockaddr_in a = addr(host, port);
    int r = connect(tcp_, reinterpret_cast<sockaddr*>(&a), sizeof a);
    st_ = (r == 0) ? boardlink::TcpState::Open : (wouldBlock() ? boardlink::TcpState::Connecting : boardlink::TcpState::Closed);
  }

  boardlink::TcpState tcpState() override {
    if (st_ == boardlink::TcpState::Connecting) {
      fd_set w, e;
      FD_ZERO(&w);
      FD_ZERO(&e);
      FD_SET(tcp_, &w);
      FD_SET(tcp_, &e);
      timeval tv{0, 0};
      if (select(static_cast<int>(tcp_) + 1, nullptr, &w, &e, &tv) > 0) {
        int err = 0;
        socklen_t el = sizeof err;
        getsockopt(tcp_, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&err), &el);
        st_ = (FD_ISSET(tcp_, &e) || err) ? boardlink::TcpState::Closed : boardlink::TcpState::Open;
      }
    }
    return st_;
  }

  bool tcpSend(const uint8_t* d, size_t n) override {
    if (st_ != boardlink::TcpState::Open) return false;
    int r = send(tcp_, reinterpret_cast<const char*>(d), static_cast<int>(n), 0);
    if (r < 0 && !wouldBlock()) st_ = boardlink::TcpState::Closed;
    return r == static_cast<int>(n);
  }

  size_t tcpReceive(uint8_t* buf, size_t cap) override {
    if (st_ != boardlink::TcpState::Open) return 0;
    int r = recv(tcp_, reinterpret_cast<char*>(buf), static_cast<int>(cap), 0);
    if (r == 0 || (r < 0 && !wouldBlock())) {
      st_ = boardlink::TcpState::Closed;  // the server closed the channel
      return 0;
    }
    return r > 0 ? static_cast<size_t>(r) : 0;
  }

  void tcpClose() override {
    if (tcp_ != INVALID_SOCKET) closeSock(tcp_);
    tcp_ = INVALID_SOCKET;
    st_ = boardlink::TcpState::Closed;
  }

 private:
  static sockaddr_in addr(const std::string& host, uint16_t port) {
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(port);
    inet_pton(AF_INET, host.c_str(), &a.sin_addr);
    return a;
  }

  sock_t udp_ = INVALID_SOCKET;
  sock_t tcp_ = INVALID_SOCKET;
  boardlink::TcpState st_ = boardlink::TcpState::Closed;
};
