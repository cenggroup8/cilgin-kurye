// Standard view: the event records on a time line, one row per event name.
// The inputs (page controls and script steps) are one grey row on top.
const NS = "http://www.w3.org/2000/svg";
const ROW = 26;
const LEFT = 150;

export class Timeline {
  constructor(el) {
    this.el = el;
    this.rows = [];
    this.events = [];
    this.end = 0;
    this.dirty = false;
    new ResizeObserver(() => this.draw()).observe(el);
    this.draw();
  }

  clear(seconds) {
    this.rows = [];
    this.events = [];
    this.end = seconds ?? 0;
    this.draw();
  }

  add(r) {
    const row = r.name === "input" ? `input: ${r.data?.name ?? ""}` : r.name;
    if (!this.rows.includes(row)) {
      // inputs first, then the other rows in the order they came
      if (r.name === "input") this.rows.splice(this.rows.filter((x) => x.startsWith("input: ")).length, 0, row);
      else this.rows.push(row);
    }
    this.events.push({ row, t: r.t, r });
    this.schedule();
  }

  tick(t) {
    if (t > this.end) {
      this.end = t;
      this.schedule();
    }
  }

  schedule() {
    if (this.dirty) return;
    this.dirty = true;
    setTimeout(() => {
      this.dirty = false;
      this.draw();
    }, 150);
  }

  draw() {
    const w = Math.max(400, this.el.clientWidth);
    if (!this.rows.length) {
      this.el.innerHTML = `<p class="empty">Henüz olay yok.</p>`;
      return;
    }
    const h = this.rows.length * ROW + 26;
    const end = Math.max(1, this.end, ...this.events.map((e) => e.t));
    const x = (t) => LEFT + ((w - LEFT - 16) * t) / end;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("height", String(h));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Events: ${this.events.length} in ${this.rows.length} kinds`);

    const el = (name, attrs, text) => {
      const n = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      svg.append(n);
      return n;
    };
    this.rows.forEach((row, i) => {
      const y = i * ROW + ROW / 2;
      el("line", { x1: LEFT, x2: w - 16, y1: y, y2: y, class: "row-line" });
      const n = this.events.filter((e) => e.row === row).length;
      el("text", { x: 0, y: y + 4 }, `${row.length > 18 ? row.slice(0, 17) + "…" : row}  ${n}`);
    });
    const step = niceStep(end);
    for (let t = 0; t <= end + 1e-9; t += step) {
      el("text", { x: x(t), y: h - 6, "text-anchor": "middle", class: "tick" }, `${+t.toFixed(2)} s`);
    }
    for (const e of this.events) {
      const i = this.rows.indexOf(e.row);
      const c = el("circle", { cx: x(e.t), cy: i * ROW + ROW / 2, r: 5, fill: e.r.name === "input" ? "var(--set)" : "var(--s1)" });
      const t = document.createElementNS(NS, "title");
      t.textContent = `${e.row}, ${e.t.toFixed(2)} s${e.r.data ? "\n" + JSON.stringify(e.r.data) : ""}`;
      c.append(t);
    }
    this.el.replaceChildren(svg);
  }
}

function niceStep(end) {
  const raw = end / 8;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw;
}
