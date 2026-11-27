import { damp } from "./motion.ts";

export const GEAR_TOPS = [0.36, 0.62, 0.79, 0.9, 1] as const;
const MIN_GEAR_S = 0.7;
const DOWN_MARGIN = 0.85;
const IDLE = 0.16;

export type Shift = "up" | "down";

export class Gearbox {
  gear = 1;
  rpm = IDLE;
  load = 0;
  private held = MIN_GEAR_S;

  update(speed: number, accel: number, topSpeed: number, dt: number): Shift | null {
    const v = Math.abs(speed);
    const top = Math.max(1, topSpeed);
    let shift: Shift | null = null;
    this.held += dt;
    const high = GEAR_TOPS[this.gear - 1] * top;
    const low = this.gear > 1 ? GEAR_TOPS[this.gear - 2] * top : 0;
    if (this.gear < GEAR_TOPS.length && v > high * 0.97 && accel > -0.5 && this.held >= MIN_GEAR_S) {
      this.gear++;
      this.held = 0;
      shift = "up";
    } else if (this.gear > 1 && v < low * DOWN_MARGIN && this.held >= MIN_GEAR_S * 0.5) {
      this.gear--;
      this.held = 0;
      shift = "down";
    }

    this.load = damp(this.load, accel > 0.3 ? 1 : accel < -1 ? 0 : 0.35, 10, dt);
    const gLow = this.gear > 1 ? GEAR_TOPS[this.gear - 2] * top * 0.55 : 0;
    const gHigh = GEAR_TOPS[this.gear - 1] * top;
    const band = Math.min(1, Math.max(0, (v - gLow) / Math.max(0.1, gHigh - gLow)));
    const ceiling = this.gear === GEAR_TOPS.length ? 0.5 : 0.66;
    const target = v < 0.3 ? IDLE + this.load * 0.12 : 0.3 + band * ceiling + this.load * 0.04;
    this.rpm = damp(this.rpm, Math.min(1, target), 16, dt);
    return shift;
  }
}
