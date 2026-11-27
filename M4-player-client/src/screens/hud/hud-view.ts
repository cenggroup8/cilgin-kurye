// The top of the game screen: time, the points of the four teams, the penalty
// countdown, a short message (toast) and the "connection lost" band.
//
// The view only shows what `update` gives it. The elements are made once and
// their texts are written again on every update, so a screen reader does not
// read a text again when it did not change. A part is shown or hidden with the
// `data-hidden` attribute ("true" or "false"); screens.css does the rest, like
// the other views do with `data-winner` and `data-mine`.

import { el } from "../dom.ts";
import type { ConnectionState, HudFrame } from "../placeholder-types.ts";
import { TEXT } from "../texts.ts";
import { formatTime, penaltyText, scoreRows } from "./hud-model.ts";

export interface HudViewState {
  frame: HudFrame;
  /** The message to show now (from the toast model), or null. */
  toast: string | null;
  connection: ConnectionState;
}

export interface HudView {
  /** Call it on every new state. */
  update(state: HudViewState): void;
  destroy(): void;
}

const EMPTY_FRAME: HudFrame = {
  remainingSeconds: 0,
  scores: [0, 0, 0, 0],
  myTeam: null,
  hasPackage: false,
  penaltySeconds: 0,
  findMeCooldownTicks: 0,
};

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  node.setAttribute("data-hidden", hidden ? "true" : "false");
}

export function createHudView(root: HTMLElement): HudView {
  const doc = root.ownerDocument;
  const hud = el(doc, "section", { class: "hud" });
  const bar = el(doc, "div", { class: "hud-bar" });
  const time = el(doc, "span", { class: "hud-time", role: "timer", "aria-label": TEXT.hud.timeLabel });
  const scores = el(doc, "div", { class: "hud-scores" });
  const scoreItems = scoreRows(EMPTY_FRAME.scores, null).map(() => {
    const item = el(doc, "span", { class: "hud-score" });
    scores.append(item);
    return item;
  });
  bar.append(time, scores);

  const penalty = el(doc, "div", { class: "hud-penalty", role: "status" });
  const toast = el(doc, "div", { class: "hud-toast", role: "status" });
  const connection = el(doc, "div", { class: "hud-connection", role: "alert" }, TEXT.hud.connectionLost);

  hud.append(bar, penalty, toast, connection);
  root.append(hud);

  function show(state: HudViewState): void {
    const { frame } = state;
    setText(time, formatTime(frame.remainingSeconds));

    scoreRows(frame.scores, frame.myTeam).forEach((row, index) => {
      const item = scoreItems[index]!;
      setText(item, `${row.name} ${row.score}`);
      item.setAttribute("style", `--team-color:${row.color}`);
      item.setAttribute("data-team", String(row.team));
      item.setAttribute("data-mine", row.mine ? "true" : "false");
    });

    const waiting = penaltyText(frame.penaltySeconds);
    setText(penalty, waiting ?? "");
    setHidden(penalty, waiting === null);

    const message = state.toast ?? "";
    setText(toast, message);
    setHidden(toast, message === "");

    setHidden(connection, state.connection === "connected");
  }
  show({ frame: EMPTY_FRAME, toast: null, connection: "connected" });

  return {
    update: show,
    destroy() {
      hud.remove();
    },
  };
}
