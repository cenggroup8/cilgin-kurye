// The countdown screen: a big number, 3, 2, 1, until the game starts.
//
// The view only shows the ticks that are left. The phase change to the game
// screen is done by the screen manager, not here. A pause in the countdown keeps
// this screen; the number then stays where it is.

import { countdownText } from "./countdown-model.ts";
import { el } from "./dom.ts";
import type { CountdownTicksLeft } from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

export interface CountdownView {
  /** Call it on every new state while the countdown is on. */
  update(ticksLeft: CountdownTicksLeft): void;
  destroy(): void;
}

export function createCountdownView(root: HTMLElement): CountdownView {
  const doc = root.ownerDocument;
  const screen = el(doc, "section", { class: "screen countdown-screen" });
  const title = el(doc, "h1", {}, TEXT.countdown.title);
  const number = el(doc, "div", { class: "countdown-number", role: "status", "aria-live": "assertive" });

  screen.append(title, number);
  root.append(screen);

  function show(ticksLeft: CountdownTicksLeft): void {
    const text = countdownText(ticksLeft);
    // Writing the same text again would make a screen reader read it again.
    if (number.textContent !== text) number.textContent = text;
  }
  show(undefined);

  return {
    update: show,
    destroy() {
      screen.remove();
    },
  };
}
