// The whole HUD of the game screen: top bar, compass, "Find me" button and the
// turn-your-phone warning. It only puts the parts together.
//
// The caller gives poses and targets already in the rule of `contracts/` (x east,
// z south, heading in degrees clockwise from north). The changes from the
// rules of M1, M3 and the predictor are in `compass-source.ts` and are NOT done
// here. The 3D scene (M4-5) is behind this HUD, the buttons of the controls (M4-2)
// are in front of it at the bottom corners.

import { compassAngle, type CompassSelf, type CompassTarget } from "./compass-model.ts";
import { createCompassView } from "./compass-view.ts";
import { createFindMeView } from "./find-me-view.ts";
import { createHudView, type HudViewState } from "./hud-view.ts";
import { createOrientationView } from "./orientation-view.ts";

export interface GameViewOptions {
  /** Called once for every press of the "Find me" button that is allowed. */
  onFindMe: () => void;
}

export interface GameViewState extends HudViewState {
  /** The own pose in the rule of contracts, or null when it is not known. */
  selfPose: CompassSelf | null;
  /** Where the compass points to (delivery point or store), or null. */
  target: CompassTarget | null;
  /** The size of the page in pixels. */
  viewport: { width: number; height: number };
}

export interface GameView {
  update(state: GameViewState): void;
  destroy(): void;
}

export function createGameView(root: HTMLElement, options: GameViewOptions): GameView {
  const hud = createHudView(root);
  const compass = createCompassView(root);
  const findMe = createFindMeView(root, { onFindMe: options.onFindMe });
  const orientation = createOrientationView(root);

  return {
    update(state) {
      hud.update({ frame: state.frame, toast: state.toast, connection: state.connection });
      const angleDeg = state.selfPose !== null && state.target !== null ? compassAngle(state.selfPose, state.target) : null;
      compass.update({ angleDeg, hasPackage: state.frame.hasPackage });
      findMe.update({ cooldownTicks: state.frame.findMeCooldownTicks });
      orientation.update(state.viewport);
    },
    destroy() {
      hud.destroy();
      compass.destroy();
      findMe.destroy();
      orientation.destroy();
    },
  };
}
