// The "turn your phone" warning on top of everything while the screen is
// higher than wide. The size comes from the caller (the page reads it).

import { el } from "../dom.ts";
import { TEXT } from "../texts.ts";
import { needsRotateWarning } from "./orientation-model.ts";

export interface OrientationViewState {
  width: number;
  height: number;
}

export interface OrientationView {
  update(state: OrientationViewState): void;
  destroy(): void;
}

export function createOrientationView(root: HTMLElement): OrientationView {
  const doc = root.ownerDocument;
  const warning = el(doc, "div", { class: "hud-rotate", role: "alert", "data-hidden": "true" }, TEXT.hud.rotateWarning);
  root.append(warning);

  let hidden: boolean | null = null;

  function show(state: OrientationViewState): void {
    const nextHidden = !needsRotateWarning(state.width, state.height);
    if (nextHidden === hidden) return;
    hidden = nextHidden;
    warning.setAttribute("data-hidden", nextHidden ? "true" : "false");
  }
  show({ width: 0, height: 0 });

  return {
    update: show,
    destroy() {
      warning.remove();
    },
  };
}
