// Standard view: line graphs of the metric records.
// One graph per unit (never two y scales in one graph); a metric without a unit gets its own graph.
// A metric whose name starts with "set_" is the value we set: drawn as a grey step line,
// so "set" and "measured" can be compared in the same graph.
import uPlot from "/vendor/uPlot.js";

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const SLOTS = 8;
const MAX_POINTS = 20000;

export class LineCharts {
  constructor(el) {
    this.el = el;
    this.groups = new Map();
    this.dirty = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
  }

  clear() {
    for (const g of this.groups.values()) g.plot.destroy();
    this.groups.clear();
    this.el.replaceChildren();
  }

  add(r) {
    const key = r.unit ? `unit:${r.unit}` : `name:${r.name}`;
    let g = this.groups.get(key);
    if (!g) g = this.make(key, r);
    let i = g.names.indexOf(r.name);
    if (i < 0) {
      if (g.colored >= SLOTS && !r.name.startsWith("set_")) {
        // A 9th series in one graph: no generated colour, it goes to its own graph.
        return this.add({ ...r, unit: undefined });
      }
      i = this.addSeries(g, r.name);
    }
    g.xs.push(r.t);
    g.ys.forEach((col, j) => col.push(j === i ? r.value : null));
    if (g.xs.length > MAX_POINTS) {
      g.xs.splice(0, g.xs.length - MAX_POINTS);
      g.ys.forEach((col) => col.splice(0, col.length - MAX_POINTS));
    }
    this.schedule();
  }

  make(key, r) {
    const box = document.createElement("section");
    box.className = "card chart";
    const h = document.createElement("h2");
    h.innerHTML = r.unit ? `<span></span><span class="unit"></span>` : `<span></span>`;
    h.children[0].textContent = r.unit ? `${r.unit}` : r.name;
    if (r.unit) h.children[1].textContent = "";
    box.append(h);
    const holder = document.createElement("div");
    box.append(holder);
    this.el.append(box);
    const g = { key, box, holder, title: h, names: [], colored: 0, xs: [], ys: [], plot: null, unit: r.unit ?? "" };
    g.plot = this.plot(g);
    this.groups.set(key, g);
    return g;
  }

  addSeries(g, name) {
    const set = name.startsWith("set_");
    const color = set ? css("--set") : css(`--s${g.colored + 1}`);
    if (!set) g.colored++;
    g.names.push(name);
    g.ys.push(g.xs.map(() => null));
    g.plot.addSeries(
      {
        label: set ? `${name.slice(4)} (set)` : name,
        stroke: color,
        width: set ? 1.5 : 2,
        dash: set ? [6, 4] : undefined,
        paths: set ? uPlot.paths.stepped({ align: 1 }) : undefined,
        spanGaps: true,
        points: { show: false },
        value: (u, v) => (v == null ? "–" : fmt(v) + (g.unit ? ` ${g.unit}` : "")),
      },
      g.names.length,
    );
    g.title.children[0].textContent = g.unit ? g.names.filter((n) => !n.startsWith("set_")).join(", ") || g.names[0] : name;
    if (g.unit) g.title.children[1].textContent = `· ${g.unit}`;
    return g.names.length - 1;
  }

  plot(g) {
    const axis = { stroke: css("--ink-2"), grid: { stroke: css("--grid"), width: 1 }, ticks: { stroke: css("--grid"), width: 1 } };
    return new uPlot(
      {
        width: Math.max(300, g.holder.clientWidth || 460),
        height: 220,
        scales: { x: { time: false } },
        legend: { live: true },
        cursor: { points: { size: 8, width: 2, stroke: css("--surface") }, drag: { x: true, y: false } },
        series: [{ label: "t", value: (u, v) => (v == null ? "–" : `${v.toFixed(1)} s`) }],
        axes: [
          { ...axis, values: (u, vals) => vals.map((v) => `${v} s`) },
          { ...axis, size: 56, values: (u, vals) => vals.map((v) => fmt(v)) },
        ],
      },
      [[]],
      g.holder,
    );
  }

  schedule() {
    if (this.dirty) return;
    this.dirty = true;
    setTimeout(() => {
      this.dirty = false;
      for (const g of this.groups.values()) g.plot.setData([g.xs, ...g.ys]);
    }, 100);
  }

  resize() {
    for (const g of this.groups.values()) {
      const w = g.holder.clientWidth;
      if (w > 0) g.plot.setSize({ width: w, height: 220 });
    }
  }
}

export function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a === 0) return "0";
  return v.toFixed(2);
}
