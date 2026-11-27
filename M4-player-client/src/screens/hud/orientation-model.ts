// "Turn your phone": the game is played sideways. No DOM.

/**
 * True only when the screen is higher than wide (portrait). Equal sides, zero,
 * negative or missing sizes give false, so a page that is not measured yet
 * does not show the warning.
 */
export function needsRotateWarning(width: number, height: number): boolean {
  return (
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    height > width
  );
}
