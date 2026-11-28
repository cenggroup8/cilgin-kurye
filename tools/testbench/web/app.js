// The page: modules on the left; choose a scenario → its card (what the module takes and gives,
// fake data, expected result, where the data comes from) → Başlat → checks, graphs, events, output.
// Talks to src/server.ts over /ws.
import { LineCharts, fmt } from "/views/lines.js";
import { Timeline } from "/views/timeline.js";

const $ = (id) => document.getElementById(id);
const charts = new LineCharts($("charts"));
const timeline = new Timeline($("timeline"));

let ws = null;
let modules = [];
let chosen = null; // { id, scenario } on the card
let head = null; // the run on the page
let running = false;
let startedAt = 0;
let lastT = 0;
let checks = new Map();
let custom = [];
let logLines = 0;

const ROLE = { code: "test edilen kod", fake: "sahte girdi", contract: "kontrat", data: "veri", test: "test programı", scenario: "senaryo", adapter: "adaptör" };
const STATE = { pr: "PR bekliyor", missing: "dosya yok", notool: "araç yok", noadapter: "adaptör yok" };

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => $("conn").classList.add("on");
  ws.onclose = () => {
    $("conn").classList.remove("on");
    setTimeout(connect, 1000);
  };
  ws.onmessage = (e) => on(JSON.parse(e.data));
}
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

function on(m) {
  switch (m.op) {
    case "modules":
      modules = m.modules;
      renderModules();
      renderRuns(m.runs);
      autoStart();
      break;
    case "about":
      if (chosen && chosen.id === m.id && chosen.scenario === m.scenario) renderSources($("src-box"), m.provenance, null);
      break;
    case "started":
      started(m);
      break;
    case "recs":
      for (const r of m.recs) rec(r);
      break;
    case "ended":
      ended(m.result);
      renderRuns(m.runs);
      break;
    case "error":
      showError(m.text);
      break;
  }
}

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};
const findModule = (id) => modules.find((m) => m.id === id);
const findScenario = (id, name) => findModule(id)?.scenarios.find((s) => s.name === name);

// ---------- side bar ----------

function renderModules() {
  const box = $("modules");
  box.replaceChildren();
  for (const m of modules) {
    const d = el("div", "mod");
    const h = el("div", "mod-head");
    h.append(el("span", null, `${m.mod} ${m.about?.name ?? m.title}`), el("span", "owner", m.owner));
    d.append(h);
    if (m.error) d.append(el("p", "why", m.error));
    if (!m.scenarios.length) d.append(el("p", "why", "henüz senaryo yok"));
    for (const s of m.scenarios) {
      const b = el("button", `scn${s.state === "ready" ? "" : " st-off"}`);
      b.dataset.key = `${m.id}/${s.name}`;
      const t = el("span", null, s.title);
      if (!s.run) t.append(el("span", "live", s.seconds === null ? "canlı" : "grafik"));
      if (s.state !== "ready") t.append(el("span", "tag", `· ${STATE[s.state] ?? s.state}`));
      b.append(t);
      b.onclick = () => choose(m.id, s.name);
      d.append(b);
    }
    box.append(d);
  }
  markActive();
}

function markActive() {
  const key = chosen ? `${chosen.id}/${chosen.scenario}` : head ? `${head.id}/${head.scenario}` : "";
  for (const b of document.querySelectorAll(".scn")) b.classList.toggle("active", b.dataset.key === key);
}

function renderRuns(runs) {
  const box = $("runs");
  box.replaceChildren();
  if (!runs?.length) box.append(el("p", "empty", "Henüz yok."));
  for (const f of (runs ?? []).slice(0, 40)) {
    const b = el("button", null, f.replace(/\.ndjson$/, ""));
    b.title = `${f} dosyasını tekrar oynat`;
    b.onclick = () => {
      showError("");
      send({ op: "replay", file: f, speed: Number($("speed").value) });
    };
    box.append(b);
  }
}

// ---------- the card before (and during) a run ----------

function choose(id, name) {
  if (running) {
    showError("Önce çalışan senaryoyu durdurun.");
    return;
  }
  showError("");
  chosen = { id, scenario: name };
  head = null;
  $("results").hidden = true;
  $("inputs").hidden = true;
  $("now").textContent = `${findModule(id).mod} — ${findScenario(id, name).title}`;
  setState("idle", "bekliyor");
  $("clock").textContent = "";
  renderAbout(findModule(id), findScenario(id, name), null);
  markActive();
  send({ op: "about", id, scenario: name });
}

function table(rows, side) {
  const t = el("table", "t");
  const hd = el("tr");
  hd.append(el("th", null, "Veri"), el("th", null, side === "from" ? "Nereden" : "Nereye"), el("th", null, "İçerik"));
  t.append(hd);
  for (const r of rows) {
    const tr = el("tr");
    tr.append(el("td", null, r.data), el("td", "from", r[side] ?? ""), el("td", null, r.content ?? ""));
    t.append(tr);
  }
  return t;
}

/** m: module, s: scenario (or the head of a replay), prov: known provenance (or null: asked) */
function renderAbout(m, s, prov, changes) {
  const box = $("about");
  box.replaceChildren();
  box.hidden = false;

  if (m?.about) {
    const a = el("section", "card");
    a.append(el("h1", null, `${m.mod} — ${m.about.name ?? m.title}`));
    if (m.about.summary) a.append(el("p", null, m.about.summary));
    const sub = [m.about.team && `Ekip: ${m.about.team}`, m.about.doc && `Belge: ${m.about.doc}`].filter(Boolean).join(" · ");
    if (sub) a.append(el("div", "sub", sub));
    if (m.about.inputs?.length || m.about.outputs?.length) {
      const io = el("div", "io");
      const i = el("div");
      i.append(el("h2", null, "Aldığı (girdi)"), table(m.about.inputs ?? [], "from"));
      const o = el("div");
      o.append(el("h2", null, "Verdiği (çıktı)"), table(m.about.outputs ?? [], "to"));
      io.append(i, o);
      a.append(io);
    }
    box.append(a);
  }

  const c = el("section", "card scn-card");
  c.append(el("h2", null, "Bu senaryo"));
  c.append(el("h1", null, s.title));
  const row = el("div", "row2");
  const f = el("div");
  f.append(el("div", "lbl", "Sahte veri (diğer modüllerin yerine)"), el("p", null, s.fake ?? "—"));
  const r = el("div");
  r.append(el("div", "lbl", "Beklenen sonuç"), el("p", null, s.result ?? (s.expect?.length ? s.expect.join(" · ") : "—")));
  row.append(f, r);
  c.append(row);
  if (s.run) {
    const k = el("div");
    k.append(el("div", "lbl", "Çalışan komut"), el("span", "cmd", `${s.run.cwd} $ ${s.run.cmd}`));
    c.append(k);
  }
  // The inputs a person may change before Başlat (edit: of the scenario), inside their bounds.
  const form = new Map();
  if (s.edit?.length && !head) {
    const g = el("div", "edit");
    const top = el("div", "lbl", "Girdiler — Başlat'tan önce değiştirilebilir");
    g.append(top);
    const row = el("div", "edit-row");
    for (const e of s.edit) {
      const d = el("label", "inp");
      d.append(el("span", null, e.label));
      const r = el("div", "row");
      const start = s.params?.[e.name] ?? e.start;
      if (e.type === "slider") {
        const inp = Object.assign(document.createElement("input"), { type: "range", min: e.min, max: e.max, step: e.step, value: start });
        const o = el("output", null, fmt(Number(start)));
        inp.oninput = () => {
          o.textContent = fmt(Number(inp.value));
          d.classList.toggle("changed", String(Number(inp.value)) !== String(start));
        };
        form.set(e.name, () => Number(inp.value));
        r.append(inp, o, el("span", "range", `${fmt(e.min)} … ${fmt(e.max)}`));
        d.reset = () => {
          inp.value = start;
          inp.oninput();
        };
      } else {
        const sel = document.createElement("select");
        for (const v of e.options) sel.append(Object.assign(document.createElement("option"), { value: String(v), textContent: String(v) }));
        sel.value = String(start);
        sel.onchange = () => d.classList.toggle("changed", sel.value !== String(start));
        form.set(e.name, () => (typeof e.options[0] === "number" ? Number(sel.value) : sel.value));
        r.append(sel);
        d.reset = () => {
          sel.value = String(start);
          sel.onchange();
        };
      }
      d.append(r);
      row.append(d);
    }
    g.append(row);
    const reset = el("button", "link", "varsayılan değerler");
    reset.onclick = () => row.querySelectorAll(".inp").forEach((x) => x.reset?.());
    g.append(reset);
    c.append(g);
  } else if (s.run && !head) {
    c.append(el("p", "note", "Bu demonun girdileri kendi dosyasında yazılı; konsol modül koduna dokunmadığı için buradan değiştirilemez. Çalıştırıp çıktısını gösterir."));
  }
  if (!head) {
    const sr = el("div", "startrow");
    const b = el("button", "start", "Başlat");
    b.disabled = s.state !== "ready";
    b.onclick = () => {
      showError("");
      const values = Object.fromEntries([...form].map(([k, get]) => [k, get()]));
      send({ op: "start", id: chosen.id, scenario: chosen.scenario, values });
    };
    sr.append(b);
    if (s.state !== "ready") sr.append(el("span", "why", `${STATE[s.state] ?? s.state}: ${s.why ?? ""}`));
    else sr.append(el("span", "why", s.run ? "Komut bitince sonuç ✓ / ✗ olarak görünür." : s.seconds === null ? "Canlı: girdileri sayfadan değiştirin, bitince Durdur." : `${s.seconds} s sürer.`));
    c.append(sr);
  }
  box.append(c);

  const src = el("section", "card src");
  src.id = "src-box";
  box.append(src);
  if (prov) renderSources(src, prov, changes);
  else src.append(el("h2", null, "Veriler nereden geliyor?"), el("p", "empty", "dosyalar okunuyor …"));
}

function renderSources(box, p, changes) {
  if (!box) return;
  box.replaceChildren();
  const h = el("h2", null, "Veriler nereden geliyor?");
  if (p?.commit) h.append(el("span", "meta", `depo ${p.branch ?? ""} @ ${p.commit}${p.dirty ? " (commit'lenmemiş değişiklik var)" : ""}`));
  box.append(h);
  if (!p?.sources?.length) {
    box.append(el("p", "empty", "Kaynak bilgisi yok."));
    return;
  }
  box.append(el("p", "note", "Bu çalıştırmanın kullandığı dosyalar. Hepsi depoda; bağlantılar GitHub'da tam bu sürümü açar. Özet (sha256), dosyanın içeriğinden hesaplanır: dosya değişirse özet de değişir."));
  const t = el("table", "t");
  const hd = el("tr");
  for (const x of ["Rol", "Dosya", "Son değişiklik", "Özet"]) hd.append(el("th", null, x));
  t.append(hd);
  for (const s of p.sources) {
    const tr = el("tr");
    tr.append(Object.assign(el("td"), {}));
    tr.lastChild.append(el("span", `role ${s.role}`, ROLE[s.role] ?? s.role));
    const td = el("td");
    if (s.url) {
      const a = el("a", "path", s.file);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener";
      td.append(a);
    } else td.append(el("span", "path", s.file));
    if (s.note) td.append(el("div", "note", s.note));
    if (!s.exists) td.append(el("div", "warn", "bu dalda yok"));
    else if (s.changed) td.append(el("div", "warn", "commit'lenmemiş değişiklik var"));
    tr.append(td);
    tr.append(el("td", "hash", s.commit ?? "—"));
    tr.append(el("td", "hash", s.sha256 ?? "—"));
    t.append(tr);
  }
  box.append(t);
  if (changes?.length) {
    const c = el("div", "changes");
    c.append(el("b", null, "Bu çalıştırmada değiştirilen girdiler: "));
    c.append(el("span", null, changes.map((x) => `${x.name} ${x.from} → ${x.to}`).join(" · ")));
    c.append(el("div", "note", "Senaryo dosyasındaki değer değişmedi; yeni değer yalnız bu çalıştırmada kullanıldı ve kayda yazıldı."));
    box.append(c);
  }
  box.append(el("div", "foot", "Her çalıştırma bu listeyle birlikte runs/ klasörüne kaydedilir; kayıt sonradan açıldığında aynı liste görünür."));
}

// ---------- a run ----------

async function started(m) {
  head = m;
  chosen = { id: m.id, scenario: m.scenario };
  running = true;
  startedAt = performance.now();
  lastT = 0;
  checks = new Map();
  logLines = 0;
  $("results").hidden = false;
  $("log").textContent = "";
  $("logcount").textContent = "";
  $("logbox").open = !!m.run; // a command demo: its output is the main thing
  charts.clear();
  timeline.clear(m.seconds ?? 0);
  $("now").replaceChildren(el("b", null, `${m.module} ${m.scenario}`), el("span", null, m.replay ? `${m.title} — kayıttan: ${m.replay}` : m.title));
  setState("running", m.replay ? "kayıttan" : "çalışıyor");
  $("stop").disabled = false;
  for (const name of m.expect ?? []) checks.set(name, null);
  renderChecks();
  renderInputs(m.inputs ?? [], !!m.replay);
  const mod = findModule(m.id);
  const sc = findScenario(m.id, m.scenario) ?? { title: m.title, run: m.run, fake: m.fake, result: m.result, expect: m.expect };
  renderAbout(mod, { ...sc, fake: m.fake ?? sc.fake, result: m.result ?? sc.result }, m.provenance ?? null, m.changes);
  markActive();

  for (const v of custom) v.end?.();
  custom = [];
  $("custom").replaceChildren();
  for (const name of m.views ?? []) {
    try {
      const vm = await import(`/views/${encodeURIComponent(name)}.js`);
      const c = el("section", "card");
      $("custom").append(c);
      custom.push(vm.default(c, { head: m }));
    } catch (e) {
      showError(`görünüm ${name}: ${e.message}`);
    }
  }
}

function rec(r) {
  if (r.t > lastT) lastT = r.t;
  timeline.tick(lastT);
  for (const v of custom) v.rec?.(r);
  if (r.kind === "metric") charts.add(r);
  else if (r.kind === "event") timeline.add(r);
  else if (r.kind === "check") {
    checks.set(r.name, r);
    renderChecks();
  } else if (r.kind === "log") log(`${r.t.toFixed(2).padStart(7)}  ${r.text}`);
}

function log(line) {
  const box = $("log");
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.append(line + "\n");
  logLines++;
  $("logcount").textContent = `(${logLines} satır)`;
  if (stick) box.scrollTop = box.scrollHeight;
}

function ended(result) {
  running = false;
  $("stop").disabled = true;
  for (const c of result.checks ?? []) checks.set(c.name, c);
  renderChecks(result);
  setState(result.passed ? "passed" : "failed", result.passed ? "geçti" : "kaldı");
  for (const v of custom) v.end?.(result);
  if (result.error) showError(result.error);
  for (const i of document.querySelectorAll("#inputs input, #inputs button, #inputs select")) i.disabled = true;
  if (head && !head.replay) {
    // Back to the card with a Start button, results stay below.
    const h = head;
    head = null;
    const m = findModule(h.id);
    const s = findScenario(h.id, h.scenario);
    if (m && s) renderAbout(m, s, h.provenance ?? null, h.changes);
    head = h;
  }
}

function setState(cls, text) {
  $("state").className = `pill ${cls}`;
  $("state").textContent = text;
}

function renderChecks(result) {
  const ul = $("checks");
  ul.replaceChildren();
  if (!checks.size) {
    const li = el("li", "empty", "Henüz kontrol yok.");
    li.style.display = "block";
    ul.append(li);
  }
  for (const [name, c] of checks) {
    const missing = c === null && result;
    const li = el("li", c === null ? (missing ? "no" : "wait") : c.ok ? "ok" : "no");
    li.append(el("span", "ic", c === null ? (missing ? "✘" : "…") : c.ok ? "✔" : "✘"), el("span", null, missing ? `${name} — hiç gelmedi` : name), el("span", "detail", c?.detail ?? ""));
    ul.append(li);
  }
  const passed = [...checks.values()].filter((c) => c?.ok).length;
  $("verdict").textContent = checks.size ? `${passed} / ${checks.size}` : "";
}

function renderInputs(inputs, replay) {
  const box = $("inputs");
  box.replaceChildren();
  box.hidden = !inputs.length || replay;
  for (const inp of inputs) {
    const d = el("div", "inp");
    const label = el("span", null, inp.label);
    d.append(label);
    const row = el("div", "row");
    d.append(row);
    if (inp.type === "slider") {
      const r = Object.assign(document.createElement("input"), { type: "range", min: inp.min, max: inp.max, step: inp.step, value: inp.start });
      const o = el("output", null, fmt(inp.start));
      r.oninput = () => (o.textContent = fmt(Number(r.value)));
      r.onchange = () => send({ op: "input", name: inp.name, value: Number(r.value) });
      row.append(r, o);
    } else if (inp.type === "select") {
      const s = document.createElement("select");
      for (const v of inp.options) s.append(Object.assign(document.createElement("option"), { value: String(v), textContent: String(v) }));
      s.value = String(inp.start);
      s.onchange = () => send({ op: "input", name: inp.name, value: typeof inp.options[0] === "number" ? Number(s.value) : s.value });
      row.append(s);
    } else if (inp.options) {
      const btns = el("div", "btns");
      for (const v of inp.options) {
        const b = el("button", null, String(v));
        b.onclick = () => send({ op: "input", name: inp.name, value: v });
        btns.append(b);
      }
      row.append(btns);
    } else {
      const b = el("button", null, inp.label);
      label.textContent = "";
      b.onclick = () => send({ op: "input", name: inp.name, value: inp.value ?? null });
      row.append(b);
    }
    box.append(d);
  }
}

// A link can open a scenario or a replay: #run=m2/3-loss30 (starts it), #show=m2/3-loss30, #replay=<file>&speed=0
let autoDone = false;
function autoStart() {
  if (autoDone || head || running) return;
  autoDone = true;
  const p = new URLSearchParams(location.hash.slice(1));
  const key = p.get("run") ?? p.get("show");
  if (key) {
    const [id, scenario] = key.split("/");
    if (findScenario(id, scenario)) {
      choose(id, scenario);
      if (p.get("run")) send({ op: "start", id, scenario });
    }
  } else if (p.get("replay")) send({ op: "replay", file: p.get("replay"), speed: Number(p.get("speed") ?? 1) });
}

$("stop").onclick = () => send({ op: "stop" });

setInterval(() => {
  if (!head) return;
  const t = running && !head.replay ? (performance.now() - startedAt) / 1000 : lastT;
  $("clock").textContent = `${t.toFixed(1)} s${head.seconds ? ` / ${head.seconds}` : ""}`;
  if (running) timeline.tick(t);
}, 200);

connect();
