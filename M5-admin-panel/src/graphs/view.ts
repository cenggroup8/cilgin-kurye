// Graph engine, drawing part (M5-4, #51).
//
// Draws the graphs of `GraphModel` with uPlot, a small chart library for time series
// (about 50 KB, MIT; K15 in #22). Every graph shows the change marks as thin vertical lines
// with the parameter's name; the seismic graph also shows each earthquake with its strength,
// zone and source.
//
// For a long run: the model keeps at most 15 minutes, a graph draws only its window, and a
// redraw happens at most once per frame, only when new data came, and not while the tab is
// hidden.

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './graphs.css';
import type { AdminUpdate } from '../comm/connection.ts';
import { chartData, chartsInUse, type ChartData, type ChartDef } from './charts.ts';
import { csvFileName, csvRows, toCsv } from './csv.ts';
import { GraphModel, type Mark } from './model.ts';

export interface GraphsOptions {
  /** Where the graphs go (the "Grafikler" panel). */
  root: HTMLElement;
  /** Where the seismic graph goes (the earthquake panel). Default: with the others. */
  seismicRoot?: HTMLElement;
  /** The communication manager of M5-1 (`AdminConnection`). */
  connection: { subscribe(listener: (e: AdminUpdate) => void): () => void };
  model?: GraphModel;
}

export interface Graphs {
  readonly model: GraphModel;
  /** Draw now (tests and the demo). */
  render(): void;
  destroy(): void;
}

const WINDOWS: ReadonlyArray<readonly [string, number]> = [['1 dk', 60_000], ['2 dk', 120_000], ['5 dk', 300_000], ['Tümü', Infinity]];
const GROUPS: ReadonlyArray<readonly [string, string]> = [['', 'Bütün grafikler'], ['game', 'Oyun'], ['net', 'Ağ']];
const CHANGE_COLOR = '#38bdf8';
const QUAKE_COLOR = '#f87171';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

interface Card {
  chart: ChartDef;
  figure: HTMLElement;
  plotBox: HTMLElement;
  empty: HTMLElement;
  plot?: uPlot;
  /** Line names of the current plot; a new line builds the plot again. */
  lineKey: string;
  data?: ChartData;
  observer?: ResizeObserver;
}

export function mountGraphs(opts: GraphsOptions): Graphs {
  const model = opts.model ?? new GraphModel();
  const root = opts.root;
  root.classList.add('ck-graphs');

  // ---- bar: window, group, CSV ----
  const bar = el('div', 'graphs-bar');
  const windowSelect = el('select');
  windowSelect.setAttribute('aria-label', 'Zaman aralığı');
  for (const [label, ms] of WINDOWS) windowSelect.append(new Option(label, String(ms)));
  windowSelect.value = '120000';
  const groupSelect = el('select');
  groupSelect.setAttribute('aria-label', 'Grafik grubu');
  for (const [value, label] of GROUPS) groupSelect.append(new Option(label, value));
  const csvButton = el('button', 'graphs-csv', 'CSV indir');
  csvButton.type = 'button';
  const status = el('p', 'graphs-status');
  status.setAttribute('role', 'status');
  bar.append(windowSelect, groupSelect, csvButton, status);
  const grid = el('div', 'graphs-grid');
  const waiting = el('p', 'graphs-waiting', 'Sunucudan ilk metrikler bekleniyor…');
  root.replaceChildren(bar, waiting, grid);

  const cards = new Map<string, Card>();
  let drawnVersion = -1;
  let frame = 0;

  function windowRange(): [number, number] {
    const to = model.latestTime();
    const ms = Number(windowSelect.value);
    // Before the window is full, it starts at the first value, so a new game is not a thin
    // line at the right edge.
    const from = Number.isFinite(ms) ? Math.max(to - ms, model.earliestTime()) : model.earliestTime();
    return [from, Math.max(to, from + 10_000)];
  }

  function makeCard(chart: ChartDef): Card {
    const figure = el('figure', `graph-card graph-${chart.group}`);
    figure.dataset.chart = chart.id;
    const caption = el('figcaption', '', chart.title);
    if (chart.unit) caption.append(el('span', 'graph-unit', ` (${chart.unit})`));
    const plotBox = el('div', 'graph-plot');
    const empty = el('p', 'graph-empty', 'Bu aralıkta değer yok.');
    figure.append(caption, plotBox, empty);
    const card: Card = { chart, figure, plotBox, empty, lineKey: '' };
    const target = chart.id === 'seismic' && opts.seismicRoot ? opts.seismicRoot : grid;
    target.append(figure);
    if (typeof ResizeObserver !== 'undefined') {
      card.observer = new ResizeObserver(() => card.plot?.setSize(size(card)));
      card.observer.observe(plotBox);
    }
    return card;
  }

  function size(card: Card): { width: number; height: number } {
    return { width: Math.max(240, card.plotBox.clientWidth), height: card.chart.id === 'seismic' ? 200 : 170 };
  }

  function buildPlot(card: Card, data: ChartData): void {
    card.plot?.destroy();
    const unit = card.chart.unit;
    const options: uPlot.Options = {
      ...size(card),
      // The window is chosen by the bar, not by the data.
      scales: { x: { time: true, auto: false, range: () => { const [f, t] = windowRange(); return [f / 1000, t / 1000]; } } },
      series: [
        { label: 'Saat', value: (_u: uPlot, v: number | null) => (v === null ? '—' : clock(v)) },
        ...data.lines.map((l) => ({
          label: l.name,
          stroke: l.color,
          width: 1.5,
          spanGaps: true,
          points: { show: card.chart.points ?? false, size: 5 },
          // Without the pointer over the graph the legend shows the newest value of each line.
          value: (u: uPlot, v: number | null, sidx: number, idx: number | null) => {
            const shown = idx === null ? lastValue(u.data[sidx] as Array<number | null>) : v;
            return shown === null || shown === undefined ? '—' : `${round(shown)}${unit ? ` ${unit}` : ''}`;
          },
        })),
      ],
      axes: [
        { stroke: '#94a3b8', grid: { stroke: 'rgba(148,163,184,.12)' }, values: (_u: uPlot, splits: number[]) => splits.map(clock) },
        { stroke: '#94a3b8', grid: { stroke: 'rgba(148,163,184,.12)' }, size: 52 },
      ],
      legend: { live: true },
      cursor: { drag: { x: false, y: false } },
      hooks: { draw: [(u: uPlot) => drawMarks(u, card.data?.marks ?? [])] },
    };
    card.plot = new uPlot(options, toAligned(data), card.plotBox);
    card.lineKey = data.lines.map((l) => l.metric).join('|');
  }

  function render(): void {
    frame = 0;
    if (typeof document !== 'undefined' && document.hidden) return;
    drawnVersion = model.version;
    const [from, to] = windowRange();
    const group = groupSelect.value;
    const charts = chartsInUse(model);
    waiting.hidden = charts.length > 0;
    for (const chart of charts) {
      let card = cards.get(chart.id);
      if (!card) cards.set(chart.id, (card = makeCard(chart)));
      const shown = !group || chart.group === group || chart.id === 'seismic';
      card.figure.hidden = !shown;
      if (!shown) continue;
      const data = chartData(model, chart, from, to);
      card.data = data;
      const hasValues = data.times.length > 0;
      card.empty.hidden = hasValues;
      card.plotBox.hidden = !hasValues;
      if (!hasValues) continue;
      const key = data.lines.map((l) => l.metric).join('|');
      if (!card.plot || key !== card.lineKey) buildPlot(card, data);
      else card.plot.setData(toAligned(data), true);
    }
    status.textContent = statusText();
  }

  function statusText(): string {
    const link = model.connection === 'connected' ? 'Bağlı' : model.connection === 'replaced' ? 'Başka bir sekme yönetiyor' : 'Yeniden bağlanıyor…';
    const board = model.boardConnected === null ? '' : model.boardConnected ? ' · tahta bağlı' : ' · tahta bağlı değil';
    const marks = model.allMarks();
    const changes = marks.filter((m) => m.kind === 'change').length;
    const quakes = marks.length - changes;
    return `${link}${board} · ${changes} değişiklik, ${quakes} deprem işareti`;
  }

  function schedule(): void {
    if (frame || model.version === drawnVersion) return;
    frame = requestAnimationFrame(render);
  }

  const stop = opts.connection.subscribe((e) => {
    if (model.apply(e)) schedule();
  });
  const redraw = () => { drawnVersion = -1; schedule(); };
  windowSelect.addEventListener('change', redraw);
  groupSelect.addEventListener('change', redraw);
  document.addEventListener('visibilitychange', redraw);
  csvButton.addEventListener('click', () => {
    const rows = csvRows(model);
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = el('a');
    a.href = url;
    a.download = csvFileName(model.latestTime());
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `${rows.length} satır CSV olarak indirildi.`;
  });

  return {
    model,
    render,
    destroy() {
      stop();
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', redraw);
      for (const c of cards.values()) {
        c.observer?.disconnect();
        c.plot?.destroy();
        c.figure.remove();
      }
      cards.clear();
    },
  };
}

function toAligned(d: ChartData): uPlot.AlignedData {
  return [d.times.map((t) => t / 1000), ...d.values] as uPlot.AlignedData;
}

const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Seconds (uPlot's time) to "13:58:30". */
function clock(seconds: number): string {
  return timeFormat.format(seconds * 1000);
}

function lastValue(values: ReadonlyArray<number | null> | undefined): number | null {
  if (!values) return null;
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined) return values[i]!;
  return null;
}

function round(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/**
 * The thin vertical line of each mark, with its name at the top. A name that would leave the
 * graph on the right goes to the left of its line, and names that would overlap go a row down.
 */
function drawMarks(u: uPlot, marks: readonly Mark[]): void {
  if (marks.length === 0) return;
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  const dpr = devicePixelRatio || 1;
  const rowH = 13 * dpr;
  const rows = Math.max(1, Math.min(4, Math.floor(height / rowH / 2)));
  const rowEnds: number[] = new Array(rows).fill(-Infinity);
  ctx.save();
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  // uPlot leaves the alignment of its axis labels on the context.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const m of marks) {
    const x = Math.round(u.valToPos(m.time / 1000, 'x', true));
    if (x < left || x > left + width) continue;
    const color = m.kind === 'quake' ? QUAKE_COLOR : CHANGE_COLOR;
    ctx.strokeStyle = color;
    ctx.lineWidth = (m.kind === 'quake' ? 2 : 1) * dpr;
    ctx.setLineDash(m.kind === 'quake' ? [] : [4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, top + height);
    ctx.stroke();
    const w = ctx.measureText(m.label).width + 6 * dpr;
    const toLeft = x + 2 * dpr + w > left + width;
    const x0 = toLeft ? x - 2 * dpr - w : x + 2 * dpr;
    let row = rowEnds.findIndex((end) => end < x0);
    if (row < 0) row = rows - 1;
    rowEnds[row] = x0 + w;
    const y = top + 2 * dpr + row * rowH;
    ctx.fillStyle = 'rgba(15,23,42,.88)';
    ctx.fillRect(x0, y - dpr, w, 12 * dpr);
    ctx.fillStyle = color;
    ctx.fillText(m.label, x0 + 3 * dpr, y);
  }
  ctx.restore();
}
