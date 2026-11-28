// Strip layout of the LED board (M6-5, plan #28 section 3.4).
//
// Reads contracts/city_plan.json and writes
//   M6-led-board/hardware/strip_layout.json  which strip piece lies on which road
//                                            segment, in which direction, in which
//                                            chain and at which LED index. Input of
//                                            the LED map (M6-3, make_led_map).
//   M6-led-board/hardware/strip_layout.svg   the same as a 1:1 drawing of the 60 × 60 cm
//                                            base (print at 100 %, it is in mm), also
//                                            usable as a template for the base.
//
// Run:   node tools/strip_layout/gen-strip-layout.mjs          (writes both files)
//        node tools/strip_layout/gen-strip-layout.mjs --check  (checks the JSON file)
// Node.js 20 or newer, no packages.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const plan = JSON.parse(readFileSync(root + "contracts/city_plan.json", "utf8"));

// ---- board parameters (proposal; change here, then run the script) -------------
const BOARD_MM = 650; // 65 × 65 cm: the printed building plates of #81 are 105 mm
const MARGIN_MM = 30; // outer roads this far from the edge of the base
const STRIP_LEDS_PER_M = 144; // WS2812B, 144 LEDs/m, as bought (5 m reels of 720 LEDs)
const STRIP_WIDTH_MM = 12; // measured on the strip
const MIN_GAP_MM = 24; // free space at a crossing: the other strip (12 mm) + about 6 mm on each side for solder pads
// Stores: a piece of 2 LEDs cut from the strip (#20: 8 store LEDs). The free store
// corner of the city plan is 30 m × 30 m; on the board, without the road, that is a
// square of about 22 mm. A piece of 2 LEDs (13.9 × 15 mm) fits there, east-west.
const STORE_LEDS = 2;
const STORE_LED_MM = [
  [18.5, 22],
  [18.5 + 1000 / STRIP_LEDS_PER_M, 22],
]; // centre of each store LED from the corner node, toward the inside of the block

const LINES = plan.grid.lines; // 6 roads in each direction
const SPAN_MM = BOARD_MM - 2 * MARGIN_MM;
const PITCH_MM = SPAN_MM / (LINES - 1); // centre to centre of two parallel roads
const LED_PITCH_MM = 1000 / STRIP_LEDS_PER_M;
const LEDS_PER_SEGMENT = Math.floor((PITCH_MM - MIN_GAP_MM) / LED_PITCH_MM);
const PIECE_MM = LEDS_PER_SEGMENT * LED_PITCH_MM;
const GAP_MM = PITCH_MM - PIECE_MM;

const r4 = (x) => Math.round(x * 10000) / 10000;
const r1 = (x) => Math.round(x * 10) / 10;

/** Board mm of a world point (contracts: x east, z south; u = x / size_m). */
function boardMm(x, z) {
  return [MARGIN_MM + (x / plan.world.size_m) * SPAN_MM, MARGIN_MM + (z / plan.world.size_m) * SPAN_MM];
}

const node = (id) => plan.nodes[id];
const segByName = new Map(plan.segments.map((s) => [s.name, s]));

/** A strip piece on a road segment, LEDs listed in chain order. */
function segmentPiece(name, dir) {
  const s = segByName.get(name);
  const a = node(s.a);
  const b = node(s.b);
  const [ax, ay] = boardMm(a.x, a.z);
  const [bx, by] = boardMm(b.x, b.z);
  const leds = [];
  for (let k = 0; k < LEDS_PER_SEGMENT; k++) {
    const fromA = GAP_MM / 2 + (k + 0.5) * LED_PITCH_MM; // mm from the centre of node a
    const t = fromA / PITCH_MM;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    leds.push({ t: r4(t), mm: [r1(x), r1(y)], u: r4(a.x / plan.world.size_m + ((b.x - a.x) / plan.world.size_m) * t), v: r4(a.z / plan.world.size_m + ((b.z - a.z) / plan.world.size_m) * t) });
  }
  if (dir === "b_to_a") leds.reverse();
  return { kind: "segment", segment: s.id, name, dir, count: leds.length, leds };
}

/** The store LEDs: single LEDs in the free corner of the corner block of the team. */
function storePiece(team) {
  const st = plan.stores.find((s) => s.team === team);
  const n = node(st.node);
  const [nx, ny] = boardMm(n.x, n.z);
  const sx = n.x < plan.world.size_m / 2 ? 1 : -1; // toward the inside of the block
  const sy = n.z < plan.world.size_m / 2 ? 1 : -1;
  const leds = STORE_LED_MM.slice(0, STORE_LEDS).map(([ox, oy]) => {
    const x = nx + sx * ox;
    const y = ny + sy * oy;
    return { mm: [r1(x), r1(y)], u: r4((x - MARGIN_MM) / SPAN_MM), v: r4((y - MARGIN_MM) / SPAN_MM) };
  });
  return { kind: "store", team, color: st.color, corner: st.corner, single_leds: true, count: leds.length, leds };
}

// ---- the two chains ----------------------------------------------------------
// Chain A: the east-west roads, row by row like a snake (row 0 to the east, row 1
// to the west, ...), with the four stores where the snake passes their corner.
// Chain B: the north-south roads, column by column like a snake.
// So every jump between two pieces is short: across one crossing, or at the end
// of a row or column to the next one.
const H = (r, c) => `h_${r}_${c}`;
const V = (r, c) => `v_${r}_${c}`;
const cols = [...Array(LINES - 1).keys()];

const chainA = [storePiece(0)];
for (let r = 0; r < LINES; r++) {
  const east = r % 2 === 0;
  if (r === LINES - 1) chainA.push(storePiece(3)); // SE store before the last row (it starts in the east)
  for (const c of east ? cols : [...cols].reverse()) chainA.push(segmentPiece(H(r, c), east ? "a_to_b" : "b_to_a"));
  if (r === 0) chainA.push(storePiece(1)); // NE store after the first row
}
chainA.push(storePiece(2)); // SW store at the end

const chainB = [];
const rows = [...Array(LINES - 1).keys()];
for (let c = 0; c < LINES; c++) {
  const south = c % 2 === 0;
  for (const r of south ? rows : [...rows].reverse()) chainB.push(segmentPiece(V(r, c), south ? "a_to_b" : "b_to_a"));
}

function numberChain(id, name, role, pieces) {
  let first = 0;
  for (const p of pieces) {
    p.first = first;
    first += p.count;
  }
  return { id, name, role, leds: first, pieces };
}

const layout = {
  version: "0.1.0",
  status: "proposal - pin numbers and power come with the parts list (#20)",
  city_plan: plan.version,
  board: {
    size_mm: BOARD_MM,
    margin_mm: MARGIN_MM,
    road_pitch_mm: r1(PITCH_MM),
    strip_leds_per_m: STRIP_LEDS_PER_M,
    led_pitch_mm: r1(LED_PITCH_MM),
    strip_width_mm: STRIP_WIDTH_MM,
    leds_per_segment: LEDS_PER_SEGMENT,
    piece_mm: r1(PIECE_MM),
    crossing_gap_mm: r1(GAP_MM),
    store_leds: STORE_LEDS,
    axes: "mm from the north-west corner of the base, x to the east, y to the south (like x, z of contracts/)",
  },
  rules: {
    t: "position on the segment from node a (0) to node b (1), as in contracts/",
    dir: "a_to_b: the data runs from node a to node b (east on h_r_c, south on v_r_c); b_to_a: the other way",
    first: "index of the first LED of the piece in its chain; the LEDs of a piece are listed in chain order",
  },
  chains: [
    numberChain(0, "A", "east-west roads h_r_c and the four stores", chainA),
    numberChain(1, "B", "north-south roads v_r_c", chainB),
  ],
};
layout.total_leds = layout.chains.reduce((s, c) => s + c.leds, 0);
layout.strip_m = r1((layout.total_leds * LED_PITCH_MM) / 1000);

// ---- check ---------------------------------------------------------------------
function check(l) {
  const errors = [];
  const seen = new Map();
  for (const ch of l.chains) {
    let next = 0;
    for (const p of ch.pieces) {
      if (p.first !== next) errors.push(`chain ${ch.name}: piece starts at ${p.first}, expected ${next}`);
      if (p.leds.length !== p.count) errors.push(`chain ${ch.name}: piece count ${p.count} but ${p.leds.length} LEDs`);
      next += p.count;
      if (p.kind === "segment") {
        seen.set(p.segment, (seen.get(p.segment) ?? 0) + 1);
        const ts = p.leds.map((x) => x.t);
        const inc = ts.every((t, i) => i === 0 || (p.dir === "a_to_b" ? t > ts[i - 1] : t < ts[i - 1]));
        if (!inc) errors.push(`${p.name}: LEDs not in the direction ${p.dir}`);
        if (Math.min(...ts) <= 0 || Math.max(...ts) >= 1) errors.push(`${p.name}: LED in a crossing`);
      }
      for (const led of p.leds) {
        if (led.mm.some((x) => x < 0 || x > l.board.size_mm)) errors.push(`LED outside the base: ${led.mm}`);
      }
    }
    if (next !== ch.leds) errors.push(`chain ${ch.name}: ${ch.leds} LEDs but pieces give ${next}`);
  }
  for (const s of plan.segments) if (seen.get(s.id) !== 1) errors.push(`segment ${s.name} has ${seen.get(s.id) ?? 0} pieces`);
  if (l.board.crossing_gap_mm < MIN_GAP_MM) errors.push(`gap at the crossings ${l.board.crossing_gap_mm} mm < ${MIN_GAP_MM} mm`);
  const stores = l.chains.flatMap((c) => c.pieces.filter((p) => p.kind === "store").map((p) => p.team)).sort();
  if (stores.join() !== "0,1,2,3") errors.push(`stores: ${stores}`);
  return errors;
}

// ---- drawing -------------------------------------------------------------------
function svg(l) {
  const out = [];
  const W = l.board.size_mm;
  const color = { A: "#2563eb", B: "#16a34a" };
  const p = (s) => out.push(s);
  p(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${W + 40}mm" viewBox="0 0 ${W} ${W + 40}" font-family="Arial, sans-serif">`);
  p(`<title>Çılgın Kurye LED board: strip layout ${l.version} (1:1, mm)</title>`);
  p(`<rect x="0" y="0" width="${W}" height="${W}" fill="#f5f5f4" stroke="#000" stroke-width="0.6"/>`);
  // Blocks and buildings area (light), road centre lines.
  for (const n of plan.nodes) {
    const [x, y] = boardMm(n.x, n.z);
    p(`<circle cx="${r1(x)}" cy="${r1(y)}" r="1.2" fill="#a8a29e"/>`);
  }
  for (const s of plan.segments) {
    const [ax, ay] = boardMm(node(s.a).x, node(s.a).z);
    const [bx, by] = boardMm(node(s.b).x, node(s.b).z);
    p(`<line x1="${r1(ax)}" y1="${r1(ay)}" x2="${r1(bx)}" y2="${r1(by)}" stroke="#d6d3d1" stroke-width="${STRIP_WIDTH_MM + 8}" stroke-linecap="square"/>`);
  }
  // Strip pieces, LEDs, data direction and jumps.
  for (const ch of l.chains) {
    let prevEnd = null;
    ch.pieces.forEach((pc, i) => {
      const first = pc.leds[0].mm;
      const last = pc.leds[pc.leds.length - 1].mm;
      const half = LED_PITCH_MM / 2;
      if (pc.kind === "store") {
        // Single LEDs: drawn as the small boards cut from the strip, joined by jumper wires.
        let prev = prevEnd;
        for (const led of pc.leds) {
          if (prev) p(`<line x1="${r1(prev[0])}" y1="${r1(prev[1])}" x2="${led.mm[0]}" y2="${led.mm[1]}" stroke="${color[ch.name]}" stroke-width="0.5" stroke-dasharray="1.5 1"/>`);
          p(`<rect x="${r1(led.mm[0] - half)}" y="${r1(led.mm[1] - STRIP_WIDTH_MM / 2)}" width="${r1(LED_PITCH_MM)}" height="${STRIP_WIDTH_MM}" fill="${color[ch.name]}" fill-opacity="0.25"/>`);
          p(`<rect x="${r1(led.mm[0] - 2.5)}" y="${r1(led.mm[1] - 2.5)}" width="5" height="5" fill="${storeColor(pc.team)}" stroke="${color[ch.name]}" stroke-width="0.4"/>`);
          prev = led.mm;
        }
        const west = first[0] < W / 2;
        const north = first[1] < W / 2;
        const tx = r1(first[0] - (west ? half : -half));
        const anchor = west ? "start" : "end";
        // Store label on the side toward the block, the data label on the other side.
        p(`<text x="${tx}" y="${r1(first[1] + (north ? 12 : -10))}" font-size="3.2" fill="${color[ch.name]}" text-anchor="${anchor}">${ch.name}${pc.first} store ${pc.team}</text>`);
        if (i === 0) p(`<text x="${r1(last[0] + (west ? half + 2 : -half - 2))}" y="${r1(first[1] + 1.4)}" font-size="4" font-weight="bold" fill="${color[ch.name]}" text-anchor="${anchor}">◀ DATA ${ch.name} in</text>`);
        prevEnd = prev;
        return;
      }
      const dx = Math.sign(last[0] - first[0]);
      const dy = Math.sign(last[1] - first[1]);
      const x1 = first[0] - dx * half;
      const y1 = first[1] - dy * half;
      const x2 = last[0] + dx * half;
      const y2 = last[1] + dy * half;
      if (prevEnd) p(`<line x1="${r1(prevEnd[0])}" y1="${r1(prevEnd[1])}" x2="${r1(x1)}" y2="${r1(y1)}" stroke="${color[ch.name]}" stroke-width="0.5" stroke-dasharray="1.5 1"/>`);
      p(`<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${color[ch.name]}" stroke-width="${STRIP_WIDTH_MM}" stroke-opacity="0.25"/>`);
      for (const led of pc.leds) p(`<rect x="${r1(led.mm[0] - 2.5)}" y="${r1(led.mm[1] - 2.5)}" width="5" height="5" fill="${pc.kind === "store" ? storeColor(pc.team) : "#fff"}" stroke="${color[ch.name]}" stroke-width="0.4"/>`);
      // Arrow at the end of the piece: the data direction (DIN → DOUT).
      const ax = last[0] + dx * (half - 1);
      const ay = last[1] + dy * (half - 1);
      const px = -dy * 2.2;
      const py = dx * 2.2;
      p(`<path d="M ${r1(ax + dx * 2.5)} ${r1(ay + dy * 2.5)} L ${r1(ax + px)} ${r1(ay + py)} L ${r1(ax - px)} ${r1(ay - py)} Z" fill="${color[ch.name]}"/>`);
      const label = `${ch.name}${pc.first}`;
      const lx = first[0] + (dy !== 0 ? 7 : 0);
      const ly = first[1] + (dx !== 0 ? -7 : 0);
      p(`<text x="${r1(lx)}" y="${r1(ly + 1.2)}" font-size="3.2" fill="${color[ch.name]}" text-anchor="middle">${label}</text>`);
      if (i === 0) p(`<text x="${r1(x1 - 9)}" y="${r1(y1 + 2)}" font-size="4" font-weight="bold" fill="${color[ch.name]}" transform="rotate(90 ${r1(x1 - 9)} ${r1(y1 + 2)})">DATA ${ch.name} in ▶</text>`);
      prevEnd = [x2, y2];
    });
  }
  // Sensor at the centre and motors under the corners (doc 10.5; zones 0, 2, 6, 8).
  p(`<circle cx="${W / 2}" cy="${W / 2}" r="8" fill="none" stroke="#dc2626" stroke-width="0.8"/>`);
  p(`<text x="${W / 2}" y="${W / 2 + 14}" font-size="4" fill="#dc2626" text-anchor="middle">sensor (under the base)</text>`);
  const third = W / 6;
  [[third, third, "M0 zone 0"], [W - third, third, "M1 zone 2"], [third, W - third, "M2 zone 6"], [W - third, W - third, "M3 zone 8"]].forEach(([x, y, t]) => {
    p(`<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="none" stroke="#7c3aed" stroke-width="0.8" stroke-dasharray="2 1"/>`);
    p(`<text x="${x}" y="${y + 12}" font-size="3.5" fill="#7c3aed" text-anchor="middle">motor ${t}</text>`);
  });
  // Scale bar and legend under the base.
  const y0 = W + 10;
  p(`<line x1="10" y1="${y0}" x2="110" y2="${y0}" stroke="#000" stroke-width="0.8"/><line x1="10" y1="${y0 - 2}" x2="10" y2="${y0 + 2}" stroke="#000" stroke-width="0.8"/><line x1="110" y1="${y0 - 2}" x2="110" y2="${y0 + 2}" stroke="#000" stroke-width="0.8"/>`);
  p(`<text x="60" y="${y0 + 6}" font-size="4" text-anchor="middle">100 mm (check after printing)</text>`);
  p(`<text x="130" y="${y0 - 1}" font-size="4">Strip layout ${l.version} from city plan ${l.city_plan}: ${l.total_leds} LEDs (${l.strip_m} m), ${l.board.leds_per_segment} per segment, road pitch ${l.board.road_pitch_mm} mm, gap at crossings ${l.board.crossing_gap_mm} mm.</text>`);
  p(`<text x="130" y="${y0 + 5}" font-size="4"><tspan fill="${color.A}">Chain A</tspan>: east-west roads and stores (${l.chains[0].leds} LEDs).  <tspan fill="${color.B}">Chain B</tspan>: north-south roads (${l.chains[1].leds} LEDs).  Arrow = data direction, dashed = jumper wire, A12 = first LED index.</text>`);
  p(`<text x="130" y="${y0 + 11}" font-size="4">View from above. North is up. Sensor and motors sit under the base.</text>`);
  p(`</svg>`);
  return out.join("\n") + "\n";
}

function storeColor(team) {
  return ["#93c5fd", "#86efac", "#d8b4fe", "#fde047"][team];
}

// ---- main ----------------------------------------------------------------------
const jsonFile = root + "M6-led-board/hardware/strip_layout.json";
const svgFile = root + "M6-led-board/hardware/strip_layout.svg";

if (process.argv.includes("--check")) {
  const onDisk = JSON.parse(readFileSync(jsonFile, "utf8"));
  const errors = check(onDisk);
  if (JSON.stringify(onDisk) !== JSON.stringify(layout)) errors.push("strip_layout.json is not what the script makes now: run the script again");
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`strip_layout.json OK: ${onDisk.total_leds} LEDs in ${onDisk.chains.length} chains, all 60 segments once`);
} else {
  const errors = check(layout);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  writeFileSync(jsonFile, JSON.stringify(layout, null, 2) + "\n");
  writeFileSync(svgFile, svg(layout));
  console.log(`wrote strip_layout.json and strip_layout.svg: ${layout.total_leds} LEDs (${layout.strip_m} m), chain A ${layout.chains[0].leds}, chain B ${layout.chains[1].leds}`);
}
