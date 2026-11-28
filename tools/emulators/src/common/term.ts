// Small terminal helpers for the two emulator screens: keys without Enter,
// a screen that is drawn again and again, and simple command line options.

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

export function numArg(args: Record<string, string | true>, key: string, def: number): number {
  const v = args[key];
  if (v === undefined || v === true) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} needs a number`);
  return n;
}

/** Calls `onKey` for every key press. Ctrl+C always quits through `onQuit`. */
export function onKeys(onKey: (key: string) => void, onQuit: () => void): void {
  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  stdin.on("data", (data: string) => {
    for (const ch of data) {
      if (ch === "\u0003") onQuit();
      else onKey(ch);
    }
  });
}

/** Draws the lines at the top of the screen, without flicker. */
export function drawScreen(lines: string[]): void {
  process.stdout.write("\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\n\x1b[J");
}

export function screenStart(): void {
  process.stdout.write("\x1b[?25l\x1b[2J"); // hide the cursor, clear
}

export function screenEnd(): void {
  process.stdout.write("\x1b[?25h\n");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}

/** A small graph with block characters: values from 0 to max. */
export function sparkline(values: readonly number[], max: number, width: number): string {
  const blocks = " ▁▂▃▄▅▆▇█";
  const v = values.slice(-width);
  return v.map((x) => blocks[Math.min(8, Math.max(0, Math.round((x / max) * 8)))]).join("").padStart(width, " ");
}
