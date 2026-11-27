// The "Find me" button. Ready: it says "Find me" and can be pressed. While M1
// says the player must wait: it is grey (disabled) and shows the seconds.
//
// A press calls `onFindMe` once, and only when the last update said ready, even
// if a browser (or a test) sends a click to a disabled button. Before the first
// update the button counts as ready: a state that is not known yet must not
// lock it.

import { el } from "../dom.ts";
import { TEXT } from "../texts.ts";
import { findMeState } from "./find-me-model.ts";

export interface FindMeViewOptions {
  onFindMe: () => void;
}

export interface FindMeViewState {
  /** Ticks until "Find me" can be used again (`findMeCooldownTicks` of the frame). */
  cooldownTicks: number;
}

export interface FindMeView {
  update(state: FindMeViewState): void;
  destroy(): void;
}

export function createFindMeView(root: HTMLElement, options: FindMeViewOptions): FindMeView {
  const doc = root.ownerDocument;
  const button = el(doc, "button", { type: "button", class: "hud-find-me" }) as HTMLButtonElement;
  let ready = true;
  let destroyed = false;
  let shownLabel: string | null = null;

  button.addEventListener("click", () => {
    if (destroyed || !ready) return;
    options.onFindMe();
  });

  function show(state: FindMeViewState): void {
    const next = findMeState(state.cooldownTicks);
    ready = next.ready;
    const label = next.ready ? TEXT.hud.findMe : TEXT.hud.findMeWait(next.secondsLeft);
    if (label !== shownLabel) {
      shownLabel = label;
      button.textContent = label;
    }
    button.disabled = !next.ready;
  }
  show({ cooldownTicks: 0 });
  root.append(button);

  return {
    update: show,
    destroy() {
      // The listener stays on the removed button, but it does nothing any more.
      destroyed = true;
      button.remove();
    },
  };
}
