// The end screen: the winner or a draw, and the points of all four teams.
//
// The four rows are made once and filled again on every update, so the page
// does not have to remove and add elements. The server gives no way back
// from here: the admin starts a new game, and the phase goes back to the lobby.

import { el } from "./dom.ts";
import { endResult } from "./end-model.ts";
import type { TeamId, TeamScores, Winners } from "./placeholder-types.ts";

export interface EndView {
  /** Call it on every new state while the game is over. `myTeam` marks the own team. */
  update(scores: TeamScores, winners: Winners, myTeam: TeamId | null): void;
  destroy(): void;
}

export function createEndView(root: HTMLElement): EndView {
  const doc = root.ownerDocument;
  const screen = el(doc, "section", { class: "screen end-screen" });
  const headline = el(doc, "h1", { class: "result-title" });
  const list = el(doc, "ol", { class: "score-list" });

  const rows = [0, 1, 2, 3].map(() => {
    const row = el(doc, "li", { class: "score-row" });
    list.append(row);
    return row;
  });

  screen.append(headline, list);
  root.append(screen);

  function show(scores: TeamScores, winners: Winners, myTeam: TeamId | null): void {
    const result = endResult(scores, winners, myTeam);
    headline.textContent = result.headline;
    headline.setAttribute("data-result", result.kind);
    result.rows.forEach((data, index) => {
      const row = rows[index]!;
      row.textContent = data.label;
      row.setAttribute("style", `--team-color:${data.color}`);
      row.setAttribute("data-winner", data.winner ? "true" : "false");
      row.setAttribute("data-mine", data.mine ? "true" : "false");
    });
  }
  show([], [], null);

  return {
    update: show,
    destroy() {
      screen.remove();
    },
  };
}
