// A simulated board for the PC tests: the motion sensor at the centre under the
// board, room noise, slow tilting, hand hits at a place (u, v) and motor shaking.
//
// Note: the hit model here follows the same idea as the detector (a hit at the
// side pushes the board sideways and tilts it to that side). So these tests show
// that the code does what the design says, with noise and random errors on top.
// They do not replace the test on the real board, where the calibration values
// are set with real hits.
#pragma once
#include <cmath>
#include <random>
#include "../src/quake/quake_types.h"

namespace sim {

constexpr float kPi = 3.14159265f;

// Random numbers that are the same with every compiler. std::mt19937 gives the
// same sequence everywhere, but std::normal_distribution and the other
// distributions do not: libstdc++ (GCC) and libc++ (Clang, macOS) differ.
inline float uniform01(std::mt19937& g) { return static_cast<float>(g() >> 8) * (1.0f / 16777216.0f); }
inline float uniformIn(std::mt19937& g, float a, float b) { return a + (b - a) * uniform01(g); }
inline float normal01(std::mt19937& g) {  // Box-Muller
  float u1 = (static_cast<float>(g() >> 8) + 1.0f) * (1.0f / 16777217.0f);  // never 0
  float u2 = uniform01(g);
  return std::sqrt(-2.0f * std::log(u1)) * std::cos(2.0f * kPi * u2);
}

struct HitSpec {
  float u = 0.5f, v = 0.5f;  // place on the board, 0..1
  float peakG = 2.0f;        // strongest shaking
};

class Board {
 public:
  explicit Board(uint32_t seed, float hz = 200.0f) : rng_(seed), dt_(1.0f / hz) {}

  float noiseG = 0.01f;     // room noise, g (per axis, standard deviation)
  float noiseDps = 0.3f;    // gyroscope noise, deg/s
  float tiltDeg = 2.0f;     // slow tilting of the table, degrees
  float edgeShare = 0.6f;   // sideways share of the push at the edge (as the real board)
  float dirErrDeg = 20.0f;  // random error of the push direction
  float distErr = 0.10f;    // random error of the distance from the centre
  float bumpG = 0.0f;       // normal play: small bumps of this size, a few per second
  float bumpsPerSecond = 3.0f;

  void hit(const HitSpec& h) {
    auto n = [](std::mt19937& g) { return normal01(g); };
    float du = h.u - 0.5f, dv = h.v - 0.5f;
    float dist = std::hypot(du, dv);
    float r = std::fmin(1.0f, dist / 0.5f);
    float ang = std::atan2(dv, du) + n(rng_) * dirErrDeg * kPi / 180.0f;
    r = std::fmax(0.0f, std::fmin(1.0f, r + n(rng_) * distErr));
    float s = r * edgeShare;  // sideways share of the push
    float hx = s * std::cos(ang), hy = s * std::sin(ang), hz = 1.0f - s;
    float len = std::sqrt(hx * hx + hy * hy + hz * hz);
    float p = h.peakG * (1.0f + 0.05f * n(rng_));
    hitAx_ = p * hx / len;
    hitAy_ = p * hy / len;
    hitAz_ = -p * hz / len;  // the board goes down first
    // Tilt to the side of the hit: (gy, -gx) points to the hit.
    float g = 25.0f * p * r;
    hitGy_ = g * std::cos(ang);
    hitGx_ = -g * std::sin(ang);
    hitT_ = 0;
    hitOn_ = true;
  }

  void motors(bool on, float g = 1.2f) { motorOn_ = on; motorG_ = g; }

  quake::ImuSample next() {
    auto n = [](std::mt19937& g) { return normal01(g); };
    t_ += dt_;
    quake::ImuSample s;
    // Gravity on a slowly tilting table.
    float tilt = tiltDeg * kPi / 180.0f * std::sin(2 * kPi * 0.05f * t_);
    s.ax = std::sin(tilt);
    s.az = std::cos(tilt);
    s.ax += noiseG * n(rng_);
    s.ay += noiseG * n(rng_);
    s.az += noiseG * n(rng_);
    s.gx = noiseDps * n(rng_);
    s.gy = noiseDps * n(rng_);
    s.gz = noiseDps * n(rng_);
    if (hitOn_) {
      // Damped ringing of the board after the hit: first push, then it rings out.
      float w = std::exp(-hitT_ / 0.02f) * std::cos(2 * kPi * 30.0f * hitT_);
      s.ax += hitAx_ * w; s.ay += hitAy_ * w; s.az += hitAz_ * w;
      s.gx += hitGx_ * w; s.gy += hitGy_ * w;
      hitT_ += dt_;
      if (hitT_ > 0.3f) hitOn_ = false;
    }
    if (motorOn_) {
      float w = motorG_ * std::sin(2 * kPi * 25.0f * t_);
      s.ax += 0.5f * w; s.ay += 0.4f * w * std::cos(2 * kPi * 3.0f * t_); s.az += 0.7f * w;
      s.gx += 8.0f * w; s.gy += 6.0f * w;
    }
    if (bumpG > 0) {
      auto u01 = [](std::mt19937& g) { return uniform01(g); };
      if (u01(rng_) < bumpsPerSecond * dt_) { bump_ = bumpG * (0.5f + 0.5f * u01(rng_)); bumpT_ = 0; }
      if (bump_ > 0) {
        float w = bump_ * std::exp(-bumpT_ / 0.015f) * std::cos(2 * kPi * 30.0f * bumpT_);
        s.ax += 0.3f * w; s.az -= 0.9f * w;
        bumpT_ += dt_;
        if (bumpT_ > 0.2f) bump_ = 0;
      }
    }
    return s;
  }

  std::mt19937& rng() { return rng_; }

 private:
  std::mt19937 rng_;
  float dt_;
  float t_ = 0;
  bool hitOn_ = false;
  float hitT_ = 0, hitAx_ = 0, hitAy_ = 0, hitAz_ = 0, hitGx_ = 0, hitGy_ = 0;
  bool motorOn_ = false;
  float motorG_ = 0;
  float bump_ = 0, bumpT_ = 0;
};

}  // namespace sim
