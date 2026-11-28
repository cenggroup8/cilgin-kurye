// The LED board drawn in the terminal: what the real board would show for the
// newest board state. Follows doc 10.5 (layers, colours, phases, lost link).
// This is the B plan view of #28: when the board is not ready, the board
// emulator shows the LED part on the screen.
//
// The LED layout here is simple and only for the screen: `ledsPerSegment`
// LEDs on each of the 60 segments (5 as in M6-led-board/hardware/strip_layout.md),
// none at the crossings, two store LEDs in each corner, one above the other.
// The real layout comes from the LED map of M6-3.

export type Rgb = readonly [number, number, number];

export interface ViewInput {
  state?: Record<string, unknown>;
  config?: Record<string, unknown>;
  link: "searching" | "connected";
  /** Time now in ms, for blinking and breathing. */
  nowMs: number;
  ledsPerSegment?: number;
  /** Plain text without colours (for tests and logs). */
  plain?: boolean;
}

export const DEFAULT_TONES: Rgb[] = [
  [80, 160, 255],
  [0, 60, 220],
  [90, 255, 90],
  [0, 150, 40],
  [200, 110, 255],
  [110, 0, 200],
  [255, 230, 80],
  [210, 140, 0],
];

const ROAD: Rgb = [70, 70, 80];
const RED: Rgb = [255, 20, 20];
const PUDDLE: Rgb = [120, 200, 255];
const WHITE: Rgb = [255, 255, 255];
const QUAKE: Rgb = [255, 150, 40];
const OFF: Rgb = [0, 0, 0];

/** Team colours (light tone) for the stores: team t is tone index 2t. */
const teamColour = (tones: Rgb[], team: number): Rgb => tones[2 * team] ?? WHITE;

type Cell = { kind: "led" | "store"; seg?: number; team?: number } | null;

/** The grid of LED places: roads every (L + 1) cells, 5 × 5 blocks. */
export function layout(L: number): { n: number; cells: Cell[][] } {
  const step = L + 1;
  const n = 5 * step + 1;
  const cells: Cell[][] = Array.from({ length: n }, () => Array<Cell>(n).fill(null));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const onRow = y % step === 0;
      const onCol = x % step === 0;
      if (onRow && !onCol) cells[y][x] = { kind: "led", seg: 5 * (y / step) + Math.floor(x / step) }; // h_r_c
      if (onCol && !onRow) cells[y][x] = { kind: "led", seg: 30 + 6 * Math.floor(y / step) + x / step }; // v_r_c
    }
  }
  // Two store LEDs in each corner block, next to the store node (strip_layout.md).
  const corners: [number, number, number][] = [
    [0, 1, 1],
    [1, n - 2, 1],
    [2, 1, n - 2],
    [3, n - 2, n - 2],
  ];
  for (const [team, cx, cy] of corners) {
    const dx = cx === 1 ? 1 : -1;
    const dy = cy === 1 ? 1 : -1;
    for (const [x, y] of [
      [cx + dx, cy],
      [cx + dx, cy + dy],
    ])
      cells[y][x] = { kind: "store", team };
  }
  return { n, cells };
}

/** Nearest LED place on a road for a board position u, v. */
export function snapToRoad(u: number, v: number, L: number): { x: number; y: number } {
  const step = L + 1;
  const n = 5 * step + 1;
  const cx = Math.min(1, Math.max(0, u)) * (n - 1);
  const cy = Math.min(1, Math.max(0, v)) * (n - 1);
  const col = Math.round(cx / step) * step;
  const row = Math.round(cy / step) * step;
  return Math.abs(cx - col) <= Math.abs(cy - row) ? { x: col, y: Math.round(cy) } : { x: Math.round(cx), y: row };
}

export function renderBoard(input: ViewInput): string[] {
  const L = input.ledsPerSegment ?? 5;
  const { n, cells } = layout(L);
  const t = input.nowMs / 1000;
  const cfg = input.config ?? {};
  const tones: Rgb[] = Array.isArray(cfg.tones) && cfg.tones.length === 8 ? (cfg.tones as Rgb[]) : DEFAULT_TONES;
  const bright = typeof cfg.bright === "number" ? cfg.bright : 0.6;
  const anim = (cfg.anim ?? {}) as Record<string, unknown>;
  const tail = typeof anim.tail === "number" ? anim.tail : 2;
  const blinkHz = typeof anim.dp_blink_hz === "number" ? anim.dp_blink_hz : 1.5;

  const colour: (Rgb | null)[][] = cells.map((row) => row.map((c) => (c ? OFF : null)));
  const put = (x: number, y: number, c: Rgb) => {
    if (y >= 0 && y < n && x >= 0 && x < n && cells[y][x]) colour[y][x] = c;
  };
  const eachLed = (fn: (x: number, y: number, c: NonNullable<Cell>) => void) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y][x]) fn(x, y, cells[y][x]!);
  };
  const breathe = (period: number) => 0.55 + 0.45 * Math.sin((2 * Math.PI * t) / period);

  const s = input.state;
  if (input.link === "searching" || !s) {
    // Lost link: roads dark, stores breathe slowly in a dim white (doc 10.5).
    const k = 0.35 * breathe(3);
    eachLed((x, y, c) => {
      if (c.kind === "store") put(x, y, scale(WHITE, k));
    });
    return draw(colour, input.plain, bright);
  }

  const ph = typeof s.ph === "number" ? s.ph : 2;
  const tl = typeof s.tl === "number" ? s.tl : 0;

  // Stores always glow in the team colours.
  eachLed((x, y, c) => {
    if (c.kind === "store") put(x, y, teamColour(tones, c.team!));
  });

  if (ph === 0) return draw(colour, input.plain, bright); // lobby: roads dark

  if (ph === 1) {
    // Countdown: light from the edge to the centre in three steps.
    const reach = Math.max(0, Math.min(3, 3 - Math.ceil(tl) + 1)) / 3;
    eachLed((x, y, c) => {
      if (c.kind !== "led") return;
      const edge = Math.max(Math.abs(x / (n - 1) - 0.5), Math.abs(y / (n - 1) - 0.5)) * 2; // 1 at the edge
      if (edge >= 1 - reach) put(x, y, scale(WHITE, 0.6));
    });
    return draw(colour, input.plain, bright);
  }

  // Layer 1: roads.
  eachLed((x, y, c) => {
    if (c.kind === "led") put(x, y, ROAD);
  });

  // Layer 2: obstacles on the whole segment. Red means "slows you down"; the
  // pattern tells the type. A puddle is light blue.
  for (const o of list(s.ob)) {
    const [seg, type] = o as number[];
    eachLed((x, y, c) => {
      if (c.kind !== "led" || c.seg !== seg) return;
      const i = x + y;
      if (type === 1) put(x, y, RED); // heavy traffic: solid red
      else if (type === 2) put(x, y, (i + Math.floor(t * 4)) % 2 ? RED : scale(RED, 0.15)); // road work: moving stripes
      else if (type === 3) put(x, y, Math.floor(t * 3) % 2 ? RED : scale(RED, 0.25)); // accident: blinking
      else if (type === 4) put(x, y, PUDDLE);
    });
  }

  // Layer 3: delivery points blink in the owner's colour; a flash when delivered.
  for (const d of list(s.dp)) {
    const [owner, u, v, state] = d as number[];
    const p = snapToRoad(u, v, L);
    const tone = tones[owner] ?? WHITE;
    const on = state === 1 || Math.floor(t * blinkHz * 2) % 2 === 0;
    if (on) put(p.x, p.y, state === 1 ? mix(tone, WHITE, 0.6) : tone);
  }

  // Layer 4: motorcycles with a short tail; "Find me" is white.
  const taken = new Map<string, Rgb[]>();
  for (const pl of list(s.p)) {
    const [id, , , flags, u, v, heading] = pl as number[];
    if (!(flags & 1)) continue; // not in the game
    const p = snapToRoad(u, v, L);
    let c = tones[id] ?? WHITE;
    if (flags & 16) c = WHITE;
    if (flags & 2 && Math.floor(t * 4) % 2) c = scale(c, 0.3); // fallen: blinks
    const rad = (heading * Math.PI) / 180;
    const dx = Math.round(Math.sin(rad));
    const dy = Math.round(-Math.cos(rad));
    // No LED in a crossing: show the dot on the last LED before it.
    if (!cells[p.y]?.[p.x]) {
      p.x -= dx;
      p.y -= dy;
      if (!cells[p.y]?.[p.x]) continue;
    }
    for (let k = tail; k >= 1; k--) {
      const tx = p.x - dx * k;
      const ty = p.y - dy * k;
      if (cells[ty]?.[tx]?.kind === "led") put(tx, ty, scale(c, 0.35 / k));
    }
    const key = `${p.x},${p.y}`;
    taken.set(key, [...(taken.get(key) ?? []), c]);
  }
  // Two motorcycles on the same LED take turns.
  for (const [key, cs] of taken) {
    const [x, y] = key.split(",").map(Number);
    colour[y][x] = cs[Math.floor(t * 2) % cs.length];
  }

  // Layer 5: earthquake shock wave, a ring growing from the centre.
  const eq = list(s.eq) as number[];
  if (eq.length >= 5 && eq[0] === 1) {
    const [, eu, ev, mag, ms] = eq;
    const r = (ms / 1000) * 0.45;
    const fade = Math.max(0, 1 - ms / 5000);
    eachLed((x, y) => {
      const d = Math.hypot(x / (n - 1) - eu, y / (n - 1) - ev);
      if (Math.abs(d - r) < 0.04 + mag * 0.004) put(x, y, scale(QUAKE, 0.4 + 0.6 * fade));
    });
  }

  // Pause: everything stays, but dim and breathing slowly.
  const k = ph === 3 ? 0.35 * breathe(2.5) : 1;
  if (k !== 1) for (const row of colour) for (let x = 0; x < row.length; x++) if (row[x]) row[x] = scale(row[x]!, k);

  return draw(colour, input.plain, bright);
}

function list(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function scale(c: Rgb, k: number): Rgb {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
}

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

/**
 * Colour view: one character per cell and two cell rows per line (upper half
 * block, foreground = upper cell, background = lower cell), so the whole board
 * fits in a terminal and still looks square. Plain view: two characters per
 * cell, one row per line.
 */
function draw(colour: (Rgb | null)[][], plain = false, bright = 0.6): string[] {
  if (plain) return colour.map((row) => row.map((c) => (!c ? "  " : isLit(c) ? "o " : ". ")).join(""));
  const k = 0.45 + 0.55 * bright; // keep dim LEDs visible on a screen
  const shown = (c: Rgb | null): Rgb | null => (!c ? null : isLit(c) ? scale(c, k) : DARK_LED);
  const lines: string[] = [];
  for (let y = 0; y < colour.length; y += 2) {
    let line = "";
    for (let x = 0; x < colour[y].length; x++) {
      const top = shown(colour[y][x]);
      const bottom = shown(colour[y + 1]?.[x] ?? null);
      if (!top && !bottom) line += " ";
      else if (top && !bottom) line += `\x1b[38;2;${top.join(";")}m▀\x1b[0m`;
      else if (!top && bottom) line += `\x1b[38;2;${bottom.join(";")}m▄\x1b[0m`;
      else line += `\x1b[38;2;${top!.join(";")};48;2;${bottom!.join(";")}m▀\x1b[0m`;
    }
    lines.push(line);
  }
  return lines;
}

/** An LED that is off, drawn dark grey so the roads stay visible. */
const DARK_LED: Rgb = [35, 35, 40];

function isLit(c: Rgb): boolean {
  return c[0] + c[1] + c[2] > 30;
}
