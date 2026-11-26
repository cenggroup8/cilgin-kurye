// The lobby screen: four team buttons and a waiting text.
//
// The view only shows `teamSlots` and tells `onPickTeam` which team was
// pressed. Whether the pick worked is known only when M2 answers, so the
// button of the chosen team changes with the next `update`, not at the press.

import { el } from "./dom.ts";
import { teamSlots, type TeamSlot } from "./lobby-model.ts";
import type { TeamCounts, TeamId } from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

export interface LobbyViewOptions {
  onPickTeam: (team: TeamId) => void;
}

export interface LobbyView {
  /** Call it on every new state. `myTeam` is null until the player has picked one. */
  update(counts: TeamCounts, myTeam: TeamId | null): void;
  destroy(): void;
}

export function createLobbyView(root: HTMLElement, options: LobbyViewOptions): LobbyView {
  const doc = root.ownerDocument;
  const screen = el(doc, "section", { class: "screen lobby-screen" });
  const title = el(doc, "h1", {}, TEXT.lobby.title);
  const list = el(doc, "div", { class: "team-list" });
  const waiting = el(doc, "p", { class: "waiting" }, TEXT.lobby.waiting);

  let slots: TeamSlot[] = teamSlots([], null);
  const buttons = slots.map((slot) => {
    const button = el(doc, "button", { type: "button", class: "team-button" }) as HTMLButtonElement;
    button.addEventListener("click", () => {
      const current = slots[slot.team];
      if (current && current.selectable) options.onPickTeam(current.team);
    });
    list.append(button);
    return button;
  });

  function render(): void {
    slots.forEach((slot, index) => {
      const button = buttons[index]!;
      button.textContent = slot.label;
      button.disabled = !slot.selectable;
      button.setAttribute("aria-pressed", slot.mine ? "true" : "false");
      button.setAttribute("style", `--team-color:${slot.color}`);
    });
  }

  screen.append(title, list, waiting);
  root.append(screen);
  render();

  return {
    update(counts, myTeam) {
      slots = teamSlots(counts, myTeam);
      render();
    },
    destroy() {
      screen.remove();
    },
  };
}
