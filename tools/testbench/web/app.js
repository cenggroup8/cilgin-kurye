// The page: module list, inputs, checks, graphs, events, log. Talks to src/server.ts over /ws.
import { LineCharts, fmt } from "/views/lines.js";
import { Timeline } from "/views/timeline.js";

const $ = (id) => document.getElementById(id);
const charts = new LineCharts($("charts"));
const timeline = new Timeline($("timeline"));

let ws = null;
let modules = [];
let head = null; // the run on the page
let running = false;
let startedAt = 0;
let lastT = 0;
let checks = new Map();
let custom = []; // module views of this run
let logLines = 0;

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
  const e = $("error");
  e.textContent = text;
  e.hidden = !text;
}

// ---------- side bar ----------

function renderModules() {
  const box = $("modules");
  box.replaceChildren();
  for (const m of modules) {
    const d = document.createElement("div");
    d.className = `mod${m.ready ? "" : " off"}`;
    const h = document.createElement("div");
    h.className = "mod-head";
    h.innerHTML = `<span></span><span class="owner"></span>`;
    h.children[0].textContent = `${m.mod} ${m.title}`;
    h.children[1].textContent = m.owner;
    d.append(h);
    if (!m.ready || m.reason) {
      const p = document.createElement("p");
      p.className = "why";
      p.textContent = m.ready ? m.reason : `not ready: ${m.reason}`;
      d.append(p);
    }
    if (m.ready) {
      for (const s of m.scenarios) {
        const b = document.createElement("button");
        b.className = "scn";
        b.dataset.key = `${m.id}/${s.name}`;
        b.innerHTML = `<span></span><small></small>`;
        b.children[0].textContent = s.name;
        if (s.seconds === null) b.children[0].insertAdjacentHTML("beforeend", `<span class="live">live</span>`);
        b.children[1].textContent = s.title;
        b.onclick = () => {
          showError("");
          send({ op: "start", id: m.id, scenario: s.name });
        };
        d.append(b);
      }
    }
    box.append(d);
  }
  markActive();
}

function markActive() {
  for (const b of document.querySelectorAll(".scn")) b.classList.toggle("active", !!head && b.dataset.key === `${head.id}/${head.scenario}`);
}

function renderRuns(runs) {
  const box = $("runs");
  box.replaceChildren();
  if (!runs?.length) box.innerHTML = `<p class="empty">None yet.</p>`;
  for (const f of (runs ?? []).slice(0, 40)) {
    const b = document.createElement("button");
    b.textContent = f.replace(/\.ndjson$/, "");
    b.title = `Play ${f} again`;
    b.onclick = () => {
      showError("");
      send({ op: "replay", file: f, speed: Number($("speed").value) });
    };
    box.append(b);
  }
}

// ---------- a run ----------

async function started(m) {
  head = m;
  running = true;
  startedAt = performance.now();
  lastT = 0;
  checks = new Map();
  logLines = 0;
  $("log").textContent = "";
  $("logcount").textContent = "";
  charts.clear();
  timeline.clear(m.seconds ?? 0);
  $("now").innerHTML = `<b></b><span></span>`;
  $("now").children[0].textContent = `${m.module} ${m.scenario}`;
  $("now").children[1].textContent = m.replay ? `${m.title} — replay of ${m.replay}` : m.title;
  setState("running", m.replay ? "replay" : "running");
  $("stop").disabled = false;
  for (const name of m.expect ?? []) checks.set(name, null);
  renderChecks();
  renderInputs(m.inputs ?? [], !!m.replay);
  markActive();

  for (const v of custom) v.end?.();
  custom = [];
  $("custom").replaceChildren();
  for (const name of m.views ?? []) {
    try {
      const mod = await import(`/views/${encodeURIComponent(name)}.js`);
      const el = document.createElement("section");
      el.className = "card";
      $("custom").append(el);
      custom.push(mod.default(el, { head: m }));
    } catch (e) {
      showError(`view ${name}: ${e.message}`);
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
  const el = $("log");
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  el.append(line + "\n");
  logLines++;
  $("logcount").textContent = `(${logLines})`;
  if (stick) el.scrollTop = el.scrollHeight;
}

function ended(result) {
  running = false;
  $("stop").disabled = true;
  for (const c of result.checks ?? []) checks.set(c.name, c);
  renderChecks(result);
  setState(result.passed ? "passed" : "failed", result.passed ? "passed" : "failed");
  for (const v of custom) v.end?.(result);
  if (result.error) showError(result.error);
  for (const i of document.querySelectorAll("#inputs input, #inputs button, #inputs select")) i.disabled = true;
}

function setState(cls, text) {
  const s = $("state");
  s.className = `pill ${cls}`;
  s.textContent = text;
}

function renderChecks(result) {
  const ul = $("checks");
  ul.replaceChildren();
  if (!checks.size) ul.innerHTML = `<li class="empty" style="display:block">No checks yet.</li>`;
  for (const [name, c] of checks) {
    const li = document.createElement("li");
    li.className = c === null ? "wait" : c.ok ? "ok" : "no";
    li.innerHTML = `<span class="ic"></span><span></span><span class="detail"></span>`;
    li.children[0].textContent = c === null ? (result ? "✘" : "…") : c.ok ? "✔" : "✘";
    li.children[1].textContent = c === null && result ? `${name} — never came` : name;
    li.children[2].textContent = c?.detail ?? "";
    if (c === null && result) li.className = "no";
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
    const d = document.createElement("div");
    d.className = "inp";
    const label = document.createElement("span");
    label.textContent = inp.label;
    d.append(label);
    const row = document.createElement("div");
    row.className = "row";
    d.append(row);
    if (inp.type === "slider") {
      const r = Object.assign(document.createElement("input"), { type: "range", min: inp.min, max: inp.max, step: inp.step, value: inp.start });
      const o = document.createElement("output");
      o.textContent = fmt(inp.start);
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
      const btns = document.createElement("div");
      btns.className = "btns";
      for (const v of inp.options) {
        const b = Object.assign(document.createElement("button"), { textContent: String(v) });
        b.onclick = () => send({ op: "input", name: inp.name, value: v });
        btns.append(b);
      }
      row.append(btns);
    } else {
      const b = Object.assign(document.createElement("button"), { textContent: inp.label });
      label.textContent = "";
      b.onclick = () => send({ op: "input", name: inp.name, value: inp.value ?? null });
      row.append(b);
    }
    box.append(d);
  }
}

// A link can start a scenario or a replay: #run=m2/3-loss30  or  #replay=<file>.ndjson&speed=0
let autoDone = false;
function autoStart() {
  if (autoDone || head) return;
  autoDone = true;
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("run")) {
    const [id, scenario] = p.get("run").split("/");
    send({ op: "start", id, scenario });
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
