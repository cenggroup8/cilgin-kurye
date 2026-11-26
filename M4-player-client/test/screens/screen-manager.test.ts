// Run from the repository root:
//   node --test "M4-player-client/test/screens/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { ScreenManager, screenForPhase } from "../../src/screens/screen-manager.ts";
import type { ScreenName } from "../../src/screens/placeholder-types.ts";

function recorded(m: ScreenManager): Array<[ScreenName, ScreenName]> {
  const log: Array<[ScreenName, ScreenName]> = [];
  m.subscribe((screen, previous) => log.push([screen, previous]));
  return log;
}

test("starts on the join screen and does not draw the scene", () => {
  const m = new ScreenManager();
  assert.equal(m.screen, "join");
  assert.equal(m.sceneWanted, false);
  assert.equal(m.joinRefusal, null);
});

test("a state before the welcome is ignored", () => {
  const m = new ScreenManager();
  m.onPhase("playing");
  assert.equal(m.screen, "join");
});

test("a full game goes through every screen in order", () => {
  const m = new ScreenManager();
  const log = recorded(m);
  m.onWelcome();
  m.onPhase("lobby");
  m.onPhase("countdown");
  m.onPhase("playing");
  m.onPhase("ended");
  m.onPhase("lobby");
  assert.deepEqual(log, [
    ["lobby", "join"],
    ["countdown", "lobby"],
    ["game", "countdown"],
    ["end", "game"],
    ["lobby", "end"],
  ]);
});

test("the welcome alone moves to the lobby", () => {
  const m = new ScreenManager();
  m.onWelcome();
  assert.equal(m.screen, "lobby");
});

test("a returning player jumps to the screen of the phase", () => {
  const m = new ScreenManager();
  m.onWelcome();
  m.onPhase("playing");
  assert.equal(m.screen, "game");
  assert.equal(m.sceneWanted, true);
});

test("the scene is wanted only on the game screen", () => {
  const m = new ScreenManager();
  m.onWelcome();
  for (const [phase, wanted] of [
    ["lobby", false],
    ["countdown", false],
    ["playing", true],
    ["ended", false],
  ] as const) {
    m.onPhase(phase);
    assert.equal(m.sceneWanted, wanted, phase);
  }
});

test("a pause keeps the screen, in the countdown and in the game", () => {
  const m = new ScreenManager();
  m.onWelcome();
  m.onPhase("countdown");
  m.onPhase("paused");
  assert.equal(m.screen, "countdown");
  m.onPhase("countdown");
  m.onPhase("playing");
  m.onPhase("paused");
  assert.equal(m.screen, "game");
  m.onPhase("playing");
  assert.equal(m.screen, "game");
});

test("a pause in the lobby keeps the lobby", () => {
  const m = new ScreenManager();
  m.onWelcome();
  m.onPhase("paused");
  assert.equal(m.screen, "lobby");
});

test("the same screen twice calls nobody", () => {
  const m = new ScreenManager();
  const log = recorded(m);
  m.onWelcome();
  m.onPhase("lobby");
  m.onPhase("lobby");
  m.onWelcome();
  assert.equal(log.length, 1);
});

test("a refused hello stays on the join screen and keeps the reason", () => {
  const m = new ScreenManager();
  m.onRefused("bad_code");
  assert.equal(m.screen, "join");
  assert.equal(m.joinRefusal, "bad_code");
  m.onWelcome();
  assert.equal(m.joinRefusal, null);
  assert.equal(m.screen, "lobby");
});

test("losing the session goes back to join and ignores states again", () => {
  const m = new ScreenManager();
  m.onWelcome();
  m.onPhase("playing");
  m.onSessionLost();
  assert.equal(m.screen, "join");
  m.onPhase("playing");
  assert.equal(m.screen, "join");
});

test("unsubscribe stops the calls", () => {
  const m = new ScreenManager();
  let calls = 0;
  const stop = m.subscribe(() => calls++);
  m.onWelcome();
  stop();
  m.onPhase("playing");
  assert.equal(calls, 1);
});

test("screenForPhase maps every phase", () => {
  assert.equal(screenForPhase("lobby"), "lobby");
  assert.equal(screenForPhase("countdown"), "countdown");
  assert.equal(screenForPhase("playing"), "game");
  assert.equal(screenForPhase("ended"), "end");
  assert.equal(screenForPhase("paused"), null);
});
