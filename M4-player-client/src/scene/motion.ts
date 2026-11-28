const MAX_STEP = 1 / 120;

export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
}

export class Spring {
  value: number;
  velocity = 0;
  frequency: number;
  damping: number;

  constructor(value = 0, frequency = 3, damping = 0.8) {
    this.value = value;
    this.frequency = frequency;
    this.damping = damping;
  }

  step(target: number, dt: number): number {
    const w = 2 * Math.PI * this.frequency;
    let left = Math.min(dt, 0.25);
    while (left > 0) {
      const h = Math.min(MAX_STEP, left);
      const accel = w * w * (target - this.value) - 2 * this.damping * w * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      left -= h;
    }
    return this.value;
  }

  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
