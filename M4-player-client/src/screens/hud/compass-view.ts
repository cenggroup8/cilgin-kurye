// The compass: an arrow that turns, and a short label for what it points to.
//
// The view only shows the angle it is given (from `compassAngle`) and does not
// compute anything. No angle (no target, no pose, a target too near) hides the
// arrow. It shows no distance and no road. The DOM is written only when a value
// changed.

import { el } from "../dom.ts";
import { TEXT } from "../texts.ts";

export interface CompassViewState {
  /** Degrees, 0 = straight ahead, positive = right. null = no arrow. */
  angleDeg: number | null;
  /** With a package the arrow points to the delivery point, without one to the store. */
  hasPackage: boolean;
}

export interface CompassView {
  update(state: CompassViewState): void;
  destroy(): void;
}

/** One decimal, and never "-0.0": the style text changes only when the arrow really moves. */
function fixed(degrees: number): string {
  const rounded = Math.round(degrees * 10) / 10;
  return (rounded === 0 ? 0 : rounded).toFixed(1);
}

export function createCompassView(root: HTMLElement): CompassView {
  const doc = root.ownerDocument;
  const box = el(doc, "div", { class: "hud-compass", role: "img" });
  const arrow = el(doc, "div", { class: "hud-compass-arrow", "data-hidden": "true" });
  const label = el(doc, "span", { class: "hud-compass-label" });
  box.append(arrow, label);
  root.append(box);

  let arrowHidden: boolean | null = null;
  let arrowStyle: string | null = null;
  let labelFor: boolean | null = null;

  function show(state: CompassViewState): void {
    const { hasPackage } = state;
    // A number that is not finite is the same as no angle.
    const angle = typeof state.angleDeg === "number" && Number.isFinite(state.angleDeg) ? state.angleDeg : null;

    if (arrowHidden !== (angle === null)) {
      arrowHidden = angle === null;
      arrow.setAttribute("data-hidden", arrowHidden ? "true" : "false");
    }
    if (angle !== null) {
      const style = `transform: rotate(${fixed(angle)}deg)`;
      if (style !== arrowStyle) {
        arrowStyle = style;
        arrow.setAttribute("style", style);
      }
    }
    if (labelFor !== hasPackage) {
      labelFor = hasPackage;
      const text = hasPackage ? TEXT.hud.compassDelivery : TEXT.hud.compassPackage;
      box.setAttribute("aria-label", text);
      label.textContent = text;
    }
  }
  show({ angleDeg: null, hasPackage: false });

  return {
    update: show,
    destroy() {
      box.remove();
    },
  };
}
