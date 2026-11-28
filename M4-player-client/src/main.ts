// Entry of the phone page (M4-3 skeleton).
//
// Until the screens of M4-1 (#66, #68, #79), the controls of M4-2 (#72) and the scene of
// M4-5 (#87) are merged, the page shows a small network panel. With it the network
// client can be tried on a real phone: join, choose a team, drive with four buttons,
// "Find me", reload the page or switch the Wi-Fi off and on.
//
// How the other parts plug in later (plan #26 section 3.2):
//   M4-1  client.subscribe(e => { welcome → screens.onWelcome(), refused → onRefused(reason),
//         state → onPhase(state.phase), connection "replaced" → onSessionLost() })
//   M4-2  new Controls((c) => client.sendControl(c)); "Find me" → client.findMe()
//   M4-4  state → own motorcycle; client.toLocalSeq(lastControlSeq) for the correction
//   M4-5  state → scene; client.fpsLimit and the "net" event; scene → client.setFps(fps)

import "./net/dev-panel.css";
import { NetClient, TEAM_COLORS, type Control } from "./net/index.ts";

const client = new NetClient();
const app = document.querySelector<HTMLElement>("#app")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const TEAM_NAMES = ["Mavi", "Yeşil", "Mor", "Sarı"];
const STATE_TEXT: Record<string, string> = {
  idle: "Bağlı değil", connecting: "Bağlanıyor…", connected: "Bağlı", reconnecting: "Bağlantı koptu, yeniden bağlanıyor…",
  refused: "Katılım reddedildi", replaced: "Bu oyuncu başka bir sayfada açıldı",
};
const REFUSAL_TEXT: Record<string, string> = { bad_code: "Oyun kodu yanlış.", full: "Oyun dolu.", bad_hello: "Katılım bilgisi geçersiz." };

// ---- join ----
const params = new URLSearchParams(location.search);
const nameInput = el("input", { name: "name", maxLength: 24, required: true, value: localStorageGet("ck.name") ?? "" });
const codeInput = el("input", { name: "code", inputMode: "numeric", pattern: "\\d{6}", maxLength: 6, required: true, value: params.get("code") ?? localStorageGet("ck.code") ?? "" });
const form = el("form", {}, el("label", {}, "Ad ", nameInput), el("label", {}, "Oyun kodu ", codeInput), el("button", { type: "submit" }, "Katıl"));
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  localStorageSet("ck.name", nameInput.value.trim());
  localStorageSet("ck.code", codeInput.value.trim());
  client.hello(nameInput.value.trim(), codeInput.value.trim());
});

// ---- lobby ----
const teams = el("div", { className: "teams" });
TEAM_NAMES.forEach((label, team) => {
  const b = el("button", { type: "button", className: `team team-${TEAM_COLORS[team]}` }, label);
  b.addEventListener("click", () => client.join(team));
  teams.append(b);
});

// ---- status ----
const status = el("p", { className: "status", role: "status" }, STATE_TEXT.idle!);
const info = el("pre", { className: "info" });

// ---- drive: a stand-in for the Controls of M4-2 until #72 is merged ----
const held = new Set<string>();
let localSeq = 0;
function publish(): void {
  const c: Control = {
    seq: ++localSeq,
    throttle: held.has("throttle") ? 1 : 0,
    brake: held.has("brake") ? 1 : 0,
    steer: (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0),
  };
  client.sendControl(c);
}
setInterval(publish, 100);
const drive = el("div", { className: "drive" });
for (const [action, label] of [["left", "←"], ["right", "→"], ["brake", "Fren"], ["throttle", "Gaz"]] as const) {
  const b = el("button", { type: "button", className: `drive-${action}` }, label);
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); held.add(action); publish(); });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"] as const) b.addEventListener(t, () => { held.delete(action); publish(); });
  drive.append(b);
}
const findMe = el("button", { type: "button", className: "find-me" }, "Find me");
findMe.addEventListener("click", () => client.findMe());

app.append(el("h1", {}, "Çılgın Kurye · ağ testi"), form, teams, status, drive, findMe, info);

// ---- what the client tells us ----
let phase = "—";
let statesThisSecond = 0;
let statesPerSecond = 0;
let lastUsed = "—";
client.subscribe((e) => {
  switch (e.t) {
    case "connection":
      status.textContent = e.state === "refused" ? `${STATE_TEXT.refused} ${REFUSAL_TEXT[client.refusedWith ?? ""] ?? ""}` : STATE_TEXT[e.state] ?? e.state;
      document.body.dataset.connection = e.state;
      break;
    case "joined":
      document.body.dataset.team = String(e.player.team);
      break;
    case "state": {
      statesThisSecond++;
      const s = e.update.state as { phase?: unknown; players?: Array<{ index?: number; control?: { seq?: number } }> };
      if (typeof s.phase === "string") phase = s.phase;
      const me = s.players?.find((p) => p.index === client.player?.player);
      if (typeof me?.control?.seq === "number") lastUsed = String(client.toLocalSeq(me.control.seq));
      break;
    }
  }
});
setInterval(() => {
  statesPerSecond = statesThisSecond;
  statesThisSecond = 0;
  const p = client.player;
  info.textContent = [
    `oyuncu: ${p ? p.player : "—"}   takım: ${p?.team ?? "—"}   geri dönüş: ${p?.returning ? "evet" : "hayır"}`,
    `durum: ${client.lastStateSeq}   saniyede: ${statesPerSecond}   faz: ${phase}`,
    `kontrol: gönderilen ${localSeq}, sunucunun kullandığı ${lastUsed}`,
    `kare hızı sınırı: ${client.fpsLimit || "yok"}   bozuk mesaj: ${client.stats.badMessages}   bağlantı denemesi: ${client.stats.links}`,
    `anahtar: ${client.key.slice(0, 8)}…`,
  ].join("\n");
}, 1000);

// ---- frame rate for the pong, and waking up after a lost Wi-Fi ----
let frames = 0;
let since = performance.now();
requestAnimationFrame(function tick(t) {
  frames++;
  if (t - since >= 1000) {
    client.setFps((frames * 1000) / (t - since));
    frames = 0;
    since = t;
  }
  requestAnimationFrame(tick);
});
addEventListener("online", () => client.wake());
document.addEventListener("visibilitychange", () => { if (!document.hidden) client.wake(); });

// A player who comes back to the page joins again by itself with the same key.
if (nameInput.value && codeInput.value) client.hello(nameInput.value, codeInput.value);

function localStorageGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* not kept */ }
}
