// Which metric goes in which graph (M5-4, #51), and the data of one graph for a time window.
// No DOM. The metric names are the ones of the fake server (#83) until M1-1 (#78) gives its
// final list; when they change, only the table below changes.

import type { GraphModel, Mark, Point } from './model.ts';

export type ChartGroup = 'game' | 'net' | 'board';

export interface ChartDef {
  id: string;
  title: string;
  unit: string;
  group: ChartGroup;
  /** The name of the line for a metric name, or null when the metric is not in this graph. */
  line(name: string): string | null;
  /** Draw dots too: for values that come once per event (a delivery), not twice per second. */
  points?: boolean;
  /** Earthquake marks on this graph (the seismic graph). Change marks are on every graph. */
  quakes?: boolean;
}

export const TEAM_NAMES = ['Mavi', 'Yeşil', 'Mor', 'Sarı'];
/** Team colours as on the board and the map (contracts/README.md). */
export const TEAM_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#eab308'];

const exact = (want: string, label: string) => (name: string) => (name === want ? label : null);
const player = (re: RegExp) => (name: string) => {
  const m = re.exec(name);
  return m ? `Oyuncu ${Number(m[1]) + 1}` : null;
};
const either = (...fs: Array<(n: string) => string | null>) => (name: string) => {
  for (const f of fs) {
    const r = f(name);
    if (r) return r;
  }
  return null;
};

export const CHARTS: readonly ChartDef[] = [
  { id: 'scores', title: 'Takım skorları', unit: 'puan', group: 'game',
    line: (n) => { const m = /^score\.(\d)$/.exec(n); return m ? TEAM_NAMES[Number(m[1])] ?? `Takım ${m[1]}` : null; } },
  { id: 'delivery-time', title: 'Teslimat süreleri', unit: 's', group: 'game', points: true, line: exact('delivery.time_s', 'Süre') },
  { id: 'delivery-distance', title: 'Teslimat mesafeleri', unit: 'm', group: 'game', points: true, line: exact('delivery.distance_m', 'Mesafe') },
  { id: 'speed', title: 'Motor hızları', unit: 'm/s', group: 'game',
    line: either(exact('speed.mean_mps', 'Ortalama'), player(/^speed\.(\d)(?:_mps)?$/)) },
  { id: 'falls', title: 'Düşmeler', unit: 'adet', group: 'game', line: either(exact('falls.total', 'Toplam'), player(/^falls\.(\d)$/)) },
  { id: 'traffic-speed', title: 'NPC trafiğinin ortalama hızı', unit: 'm/s', group: 'game', line: exact('traffic.npc_speed_mps', 'NPC hızı') },
  { id: 'traffic-count', title: 'NPC araç sayısı', unit: 'adet', group: 'game', line: exact('traffic.car_count', 'Araç') },
  { id: 'ping', title: 'Ping ve tahta gecikmesi', unit: 'ms', group: 'net',
    line: either(player(/^net\.(\d)\.ping_ms$/), exact('board.delay_ms', 'Tahta')) },
  { id: 'jitter', title: 'Jitter', unit: 'ms', group: 'net', line: player(/^net\.(\d)\.jitter_ms$/) },
  { id: 'loss', title: 'Kayıp', unit: '%', group: 'net', line: either(player(/^net\.(\d)\.loss_pct$/), exact('board.loss_pct', 'Tahta')) },
  { id: 'fps', title: 'Kare hızı', unit: 'fps', group: 'net', line: player(/^net\.(\d)\.fps$/) },
  { id: 'seismic', title: 'Sismik grafik (tahta sensörü)', unit: 'g', group: 'board', quakes: true,
    line: (n) => (/^board\.(accel|sensor|seismic)/.test(n) ? 'İvme' : null) },
];

/** A graph for each first part of a name that no graph above takes ("Diğer: physics"). */
export function otherChart(name: string): ChartDef {
  const head = name.split('.')[0] ?? name;
  return { id: `other-${head}`, title: `Diğer: ${head}`, unit: '', group: head === 'net' ? 'net' : head === 'board' ? 'board' : 'game', line: (n) => (n.split('.')[0] === head ? n : null) };
}

/** The graph of a metric name, and its line name. */
export function chartOf(name: string): { chart: ChartDef; line: string } {
  for (const chart of CHARTS) {
    const line = chart.line(name);
    if (line) return { chart, line };
  }
  const chart = otherChart(name);
  return { chart, line: name };
}

export interface ChartLine { name: string; metric: string; color: string }

/** Data of one graph for a window: shared times and one value list per line (null: no value). */
export interface ChartData {
  lines: ChartLine[];
  /** Server time in ms. */
  times: number[];
  values: Array<Array<number | null>>;
  marks: Mark[];
}

const PALETTE = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#94a3b8'];

export function lineColor(chart: ChartDef, line: string, index: number): string {
  if (chart.id === 'scores') {
    const team = TEAM_NAMES.indexOf(line);
    if (team >= 0) return TEAM_COLORS[team]!;
  }
  if (line === 'Tahta') return '#e2e8f0';
  const m = /^Oyuncu (\d+)$/.exec(line);
  if (m) return PALETTE[(Number(m[1]) - 1) % PALETTE.length]!;
  return PALETTE[index % PALETTE.length]!;
}

/** Graphs that have at least one series now, in the order of `CHARTS`, then the others. */
export function chartsInUse(model: GraphModel): ChartDef[] {
  const used = new Map<string, ChartDef>();
  for (const name of model.names()) {
    const { chart } = chartOf(name);
    used.set(chart.id, chart);
  }
  const known = CHARTS.filter((c) => used.has(c.id));
  const others = [...used.values()].filter((c) => !CHARTS.includes(c)).sort((a, b) => a.id.localeCompare(b.id));
  return [...known, ...others];
}

function sortLines(a: string, b: string): number {
  const na = /^Oyuncu (\d+)$/.exec(a);
  const nb = /^Oyuncu (\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  const ta = TEAM_NAMES.indexOf(a);
  const tb = TEAM_NAMES.indexOf(b);
  if (ta >= 0 && tb >= 0) return ta - tb;
  return a.localeCompare(b, 'tr');
}

/**
 * The lines of one graph between `from` and `to` (server ms), on shared times.
 * Metrics come in batches with one time for all, so the times mostly line up; where a line
 * has no value at a time, it gets null and the graph joins over it.
 */
export function chartData(model: GraphModel, chart: ChartDef, from: number, to: number): ChartData {
  const found: Array<{ line: string; metric: string; pts: readonly Point[] }> = [];
  for (const metric of model.names()) {
    const c = chartOf(metric);
    if (c.chart.id === chart.id) found.push({ line: c.line, metric, pts: model.points(metric) });
  }
  found.sort((a, b) => sortLines(a.line, b.line));
  const timeSet = new Set<number>();
  const windows = found.map(({ pts }) => {
    const inWindow = pts.filter((p) => p.time >= from && p.time <= to);
    for (const p of inWindow) timeSet.add(p.time);
    return inWindow;
  });
  const times = [...timeSet].sort((a, b) => a - b);
  const index = new Map(times.map((t, i) => [t, i]));
  const values = windows.map((pts) => {
    const row: Array<number | null> = new Array(times.length).fill(null);
    for (const p of pts) row[index.get(p.time)!] = p.value;
    return row;
  });
  // On the seismic graph the earthquake's own mark says more than the "quake" command's line.
  const marks = model.allMarks().filter((m) => m.time >= from && m.time <= to &&
    (m.kind === 'change' ? !(chart.quakes && m.label === 'quake') : chart.quakes === true));
  return {
    lines: found.map((f, i) => ({ name: f.line, metric: f.metric, color: lineColor(chart, f.line, i) })),
    times,
    values,
    marks,
  };
}
