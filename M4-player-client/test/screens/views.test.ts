// Tests of the join and lobby views with a very small fake DOM (see fake-dom.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createJoinView } from "../../src/screens/join-view.ts";
import { createLobbyView } from "../../src/screens/lobby-view.ts";
import { fakeRoot, type FakeElement } from "./fake-dom.ts";

function joinSetup(initialName = "", initialCode = "") {
  const root = fakeRoot();
  const submits: Array<[string, string]> = [];
  const view = createJoinView(root as unknown as HTMLElement, {
    initialName,
    initialCode,
    onSubmit: (name, code) => submits.push([name, code]),
  });
  const form = root.children[0]!;
  return {
    root,
    view,
    submits,
    form,
    name: root.byId("join-name"),
    code: root.byId("join-code"),
    message: root.byClass("form-message")[0]!,
    button: root.findAll((n) => n.tag === "button")[0]!,
  };
}

test("join: shows the first values", () => {
  const s = joinSetup("Selim", "123456");
  assert.equal(s.name.value, "Selim");
  assert.equal(s.code.value, "123456");
});

test("join: a code from the QR code puts the cursor in the name field", () => {
  const s = joinSetup("", "123456");
  assert.equal(s.root.ownerDocument.focused, s.name);
  const t = joinSetup("", "");
  assert.equal(t.root.ownerDocument.focused, null);
});

test("join: the code field keeps only digits", () => {
  const s = joinSetup();
  s.code.value = "12 ab 34-5678";
  s.code.dispatch("input");
  assert.equal(s.code.value, "123456");
});

test("join: an empty name or a short code is not sent and shows a message", () => {
  const s = joinSetup();
  s.code.value = "123";
  const result = s.form.dispatch("submit");
  assert.equal(result.defaultPrevented, true);
  assert.deepEqual(s.submits, []);
  assert.match(s.message.textContent, /name/i);
  assert.match(s.message.textContent, /6 digits/);
});

test("join: a good form is sent once with clean values and clears the message", () => {
  const s = joinSetup();
  s.form.dispatch("submit");
  assert.notEqual(s.message.textContent, "");
  s.name.value = "  Ayşe  Nur ";
  s.code.value = "654321";
  s.form.dispatch("submit");
  assert.deepEqual(s.submits, [["Ayşe Nur", "654321"]]);
  assert.equal(s.message.textContent, "");
});

test("join: a refusal shows its text and null clears it", () => {
  const s = joinSetup();
  s.view.setRefusal("bad_code");
  assert.match(s.message.textContent, /Wrong game code/);
  s.view.setRefusal("full");
  assert.match(s.message.textContent, /full/);
  s.view.setRefusal(null);
  assert.equal(s.message.textContent, "");
});

test("join: while busy the button is off and nothing is sent", () => {
  const s = joinSetup("Selim", "123456");
  s.view.setBusy(true);
  assert.equal(s.button.disabled, true);
  s.form.dispatch("submit");
  assert.deepEqual(s.submits, []);
  s.view.setBusy(false);
  assert.equal(s.button.disabled, false);
  s.form.dispatch("submit");
  assert.equal(s.submits.length, 1);
});

test("join: destroy removes the screen", () => {
  const s = joinSetup();
  s.view.destroy();
  assert.equal(s.root.children.length, 0);
});

function lobbySetup() {
  const root = fakeRoot();
  const picks: number[] = [];
  const view = createLobbyView(root as unknown as HTMLElement, { onPickTeam: (t) => picks.push(t) });
  const buttons: FakeElement[] = root.byClass("team-button");
  return { root, view, picks, buttons };
}

test("lobby: four buttons, all open at the start", () => {
  const l = lobbySetup();
  assert.equal(l.buttons.length, 4);
  assert.deepEqual(
    l.buttons.map((b) => b.disabled),
    [false, false, false, false],
  );
  assert.equal(l.buttons[0]!.textContent, "Blue · 0/2");
});

test("lobby: a full team is off, the own team is marked", () => {
  const l = lobbySetup();
  l.view.update([2, 1, 0, 0], 1);
  assert.equal(l.buttons[0]!.disabled, true);
  assert.equal(l.buttons[0]!.textContent, "Blue · 2/2 · Full");
  assert.equal(l.buttons[1]!.disabled, true);
  assert.equal(l.buttons[1]!.getAttribute("aria-pressed"), "true");
  assert.equal(l.buttons[1]!.textContent, "Green · 1/2 · Your team");
  assert.equal(l.buttons[2]!.disabled, false);
  assert.equal(l.buttons[2]!.getAttribute("aria-pressed"), "false");
});

test("lobby: each button carries its team colour", () => {
  const l = lobbySetup();
  assert.match(l.buttons[3]!.getAttribute("style") ?? "", /--team-color:#e0b020/);
});

test("lobby: pressing an open team tells the team number", () => {
  const l = lobbySetup();
  l.view.update([2, 0, 0, 0], null);
  l.buttons[2]!.dispatch("click");
  assert.deepEqual(l.picks, [2]);
});

test("lobby: pressing a full team or the own team tells nobody", () => {
  const l = lobbySetup();
  l.view.update([2, 1, 0, 0], 1);
  l.buttons[0]!.dispatch("click");
  l.buttons[1]!.dispatch("click");
  assert.deepEqual(l.picks, []);
});

test("lobby: a team that was full opens again with the next update", () => {
  const l = lobbySetup();
  l.view.update([2, 0, 0, 0], null);
  assert.equal(l.buttons[0]!.disabled, true);
  l.view.update([1, 0, 0, 0], null);
  assert.equal(l.buttons[0]!.disabled, false);
  l.buttons[0]!.dispatch("click");
  assert.deepEqual(l.picks, [0]);
});

test("lobby: destroy removes the screen", () => {
  const l = lobbySetup();
  l.view.destroy();
  assert.equal(l.root.children.length, 0);
});
