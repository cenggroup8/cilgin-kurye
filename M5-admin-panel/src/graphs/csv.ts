// CSV export of the graphs (M5-4, #51). No DOM.
//
// The file is written from the same data the graphs draw (`GraphModel`), so its values are
// the values in the graphs. One row per value, so new metrics need no new columns:
//
//   time_iso,time_ms,kind,graph,line,metric,value,note
//   2026-11-28T10:42:01.500Z,1795862521500,sample,Ping ve tahta gecikmesi,Oyuncu 1,net.0.ping_ms,7.25,
//   2026-11-28T10:42:03.000Z,1795862523000,change,,,,,physics.npc_count
//   2026-11-28T10:42:09.000Z,1795862529000,quake,Sismik grafik (tahta sensörü),,,6,M6.0 · merkez · el

import { chartOf } from './charts.ts';
import type { GraphModel } from './model.ts';

export const CSV_HEADER = ['time_iso', 'time_ms', 'kind', 'graph', 'line', 'metric', 'value', 'note'] as const;

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
export function field(v: string | number | undefined): string {
  if (v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : v;
  // A text that a spreadsheet would run as a formula is written as text.
  const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface CsvRow { time: number; kind: 'sample' | 'change' | 'quake'; graph?: string; line?: string; metric?: string; value?: number; note?: string }

/** Every kept value and mark between `from` and `to` (server ms), oldest first. */
export function csvRows(model: GraphModel, from = -Infinity, to = Infinity): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const metric of model.names()) {
    const { chart, line } = chartOf(metric);
    for (const p of model.points(metric)) {
      if (p.time >= from && p.time <= to) rows.push({ time: p.time, kind: 'sample', graph: chart.title, line, metric, value: p.value });
    }
  }
  for (const m of model.allMarks()) {
    if (m.time < from || m.time > to) continue;
    rows.push(m.kind === 'change'
      ? { time: m.time, kind: 'change', note: m.label }
      : { time: m.time, kind: 'quake', graph: 'Sismik grafik (tahta sensörü)', value: m.mag, note: m.label });
  }
  const order = { change: 0, quake: 1, sample: 2 } as const;
  return rows.sort((a, b) => a.time - b.time || order[a.kind] - order[b.kind] || (a.metric ?? '').localeCompare(b.metric ?? ''));
}

export function toCsv(rows: readonly CsvRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push([new Date(r.time).toISOString(), r.time, r.kind, r.graph, r.line, r.metric, r.value, r.note].map(field).join(','));
  }
  // A byte order mark, so a spreadsheet opens the Turkish letters right.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** File name with the server time, for example `cilgin-kurye-grafikler-2026-11-28-13-42.csv`. */
export function csvFileName(serverTime: number): string {
  const d = new Date(serverTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `cilgin-kurye-grafikler-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}.csv`;
}
