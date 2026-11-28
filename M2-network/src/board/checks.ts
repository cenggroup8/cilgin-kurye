// What the board accepts in a config and a vibrate command (M2-4). The same limits as the
// board program (M6-1, firmware/src/link/protocol.cpp, readConfig and readVibrate), so a
// message the board would throw away is caught here, before it is sent.
// Field meanings: contracts/board_protocol.md section 4.

/** null when the config is fine, else what is wrong. */
export function checkConfig(d: Record<string, unknown>): string | null {
  if (typeof d.plan !== "string") return "plan: text needed";
  if (!inRange(d.bright, 0.1, 1)) return "bright: 0.1–1";
  if (!inRange(d.max_ma, 0, 65535)) return "max_ma: 0–65535";
  const tones = d.tones;
  if (!Array.isArray(tones) || tones.length !== 8) return "tones: 8 colours needed";
  for (const [k, t] of tones.entries()) {
    if (!Array.isArray(t) || t.length !== 3 || !t.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
      return `tones[${k}]: [red, green, blue], whole numbers 0–255`;
    }
  }
  if (d.anim !== undefined) {
    const a = d.anim as Record<string, unknown> | null;
    if (typeof a !== "object" || a === null || Array.isArray(a)) return "anim: a map";
    if (!inRange(a.tail, 0, 20)) return "anim.tail: 0–20";
    if (!inRange(a.dp_blink_hz, 0, 20)) return "anim.dp_blink_hz: 0–20";
  }
  return null;
}

export type VibrateCommand = { mask: number; duty: number; ms: number; ramp_ms: number };

/** null when the command is fine, else what is wrong. */
export function checkVibrate(d: VibrateCommand): string | null {
  if (!Number.isInteger(d.mask) || d.mask < 0 || d.mask > 15) return "mask: whole number 0–15";
  if (!inRange(d.duty, 0, 1)) return "duty: 0–1";
  if (!inRange(d.ms, 0, 60000)) return "ms: 0–60000";
  if (!inRange(d.ramp_ms, 0, 60000)) return "ramp_ms: 0–60000";
  return null;
}

function inRange(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
