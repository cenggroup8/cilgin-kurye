/**
 * Fixed values of the motorcycle model. They are not admin parameters (the
 * admin changes top speed and grip, see ../params.ts), but they live here in
 * one place so the test page can tune them.
 */
export interface BikeTuning {
  /** Throttle acceleration at low speed, m/s². It gets smaller near the top speed. */
  accel: number;
  /** Full brake deceleration, m/s². Also used to slow down to a speed cap. */
  brake: number;
  /** Air drag, 1/s: without throttle the speed falls by drag × speed every second. Full throttle holds the top speed against it. */
  drag: number;
  /** Distance between the wheels, m. */
  wheelbase: number;
  /** Largest front wheel angle at walking speed, radians. Sets the U turn circle. */
  steerLow: number;
  /** Speed where the largest wheel angle is half of steerLow, m/s. */
  steerRefSpeed: number;
  /** Largest lean angle for drawing, radians. */
  maxLean: number;
  /** TAHMİN. Reverse starts when the brake is held, there is no throttle and the speed is at or below this, m/s. */
  reverseEnterSpeed: number;
  /** TAHMİN. Reverse acceleration with full brake, m/s². */
  reverseAccel: number;
  /** TAHMİN. Largest reverse speed, m/s. Must stay below physics.fall_speed_mps (6), so backing into a wall is never a fall. */
  reverseMax: number;
}

export const DEFAULT_BIKE_TUNING: Readonly<BikeTuning> = {
  accel: 6,
  brake: 10,
  drag: 0.15,
  wheelbase: 1.4,
  steerLow: (35 * Math.PI) / 180,
  steerRefSpeed: 5,
  maxLean: (45 * Math.PI) / 180,
  reverseEnterSpeed: 0.05,
  reverseAccel: 3,
  reverseMax: 2.5,
};

/** Gravity, m/s². */
export const G = 9.81;
