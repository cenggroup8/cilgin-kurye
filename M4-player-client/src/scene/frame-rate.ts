const WINDOW_MS = 500;
const SLACK_MS = 1.5;

export class FrameRate {
  fps = 0;
  private limitFps: number | null = null;
  private lastDraw = -Infinity;
  private windowStart = -1;
  private frames = 0;
  private pending = 0;

  get limit(): number | null {
    return this.limitFps;
  }

  set limit(value: number | null) {
    this.limitFps = value && value > 0 ? Math.min(240, Math.max(10, value)) : null;
  }

  frame(now: number, dt: number): number | null {
    this.pending += dt;
    if (this.limitFps !== null && now - this.lastDraw < 1000 / this.limitFps - SLACK_MS) return null;
    this.lastDraw = now;
    if (this.windowStart < 0) this.windowStart = now;
    this.frames++;
    if (now - this.windowStart >= WINDOW_MS) {
      this.fps = Math.round((this.frames * 1000) / (now - this.windowStart));
      this.frames = 0;
      this.windowStart = now;
    }
    const step = this.pending;
    this.pending = 0;
    return step;
  }
}
