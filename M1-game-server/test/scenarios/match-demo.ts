// M1-2 demo: a scripted match with the real times of the document
// (3 s countdown, 5 min game, 30 s wait for a lost player).
// Runs without M2, M3 and the game loop: this script plays their part
// and calls the match tick by tick, as the loop will do.
//   npm run demo:match
import { Match, TICKS_PER_SECOND, type MatchEvent } from "../../src/match/match.js";

const m = new Match();
let tick = 0;
const time = () => `${(tick / TICKS_PER_SECOND).toFixed(1).padStart(6)} s`;
const say = (text: string) => console.log(`${time()}  ${text}`);

function show(e: MatchEvent): void {
  if (e.type === "phase") say(`phase: ${e.from} → ${e.to}`);
  if (e.type === "bot_took_over") say(`a bot takes over player ${e.playerNo}`);
  if (e.type === "player_back") say(`player ${e.playerNo} is back` + (e.fromBot ? ", the bot gives the motorcycle back" : ""));
  if (e.type === "game_over") say(e.draw ? `draw between teams ${e.winners.join(" and ")}` : `team ${e.winners[0]} wins`);
}

function until(seconds: number, scores = [0, 0, 0, 0]): void {
  while (tick < seconds * TICKS_PER_SECOND) {
    tick++;
    m.tick(scores).forEach(show);
  }
}

function admin(name: string, r: { ok: boolean; error?: string }): void {
  say(`admin ${name}: ${r.ok ? "ok" : `error (${r.error})`}`);
}

console.log("Game 1: one human, three bots, pauses, a lost player, early end\n");
say(`join Ayşe to team 0: ${m.join("key-ayse", 0, "Ayşe", 0).ok ? "ok" : "error"}`);
admin("start with 3 bots", m.start(3));
say(`roster: ${m.roster.map((p) => `${p.playerNo}:${p.human ? p.name : "bot"}(team ${p.team})`).join(" ")}`);
until(1);
admin("pause in the countdown", m.pause());
until(5);
admin("resume (countdown starts again)", m.resume());
until(20);
say("Ayşe's link is lost"); m.lost("key-ayse");
until(35);
say("Ayşe comes back after 15 s"); m.returned("key-ayse");
until(60);
say("Ayşe's link is lost again"); m.lost("key-ayse");
until(80);
admin("pause", m.pause());
until(140);
say(`after a 60 s pause the game time is ${(m.gameTimeTicks / TICKS_PER_SECOND).toFixed(1)} s, the wait stopped too`);
admin("resume", m.resume());
until(100 + 60);
say("Ayşe comes back"); m.returned("key-ayse");
until(200);
admin("end the game early (scores 6, 9, 4, 2)", m.end([6, 9, 4, 2]));
m.tick([0, 0, 0, 0]).forEach(show);

console.log("\nGame 2: reset, the full 5 minutes, equal points\n");
tick = 0;
admin("reset", m.reset());
m.tick([0, 0, 0, 0]).forEach(show);
admin("start with 7 bots", m.start(7));
until(3 + 300, [8, 8, 3, 5]);
