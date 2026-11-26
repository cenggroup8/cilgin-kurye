/** Bike state used by the predictor and the stub physics. */
export interface BikeState {
  x: number;
  z: number;
  angle: number;   // radians, 0 = +Z direction
  speed: number;    // units per second
  fallen: boolean;
  paused: boolean;
}

/** A single control frame sent to the server. */
export interface Control {
  seq: number;       // monotonically increasing control number
  throttle: number;  // 0..1
  brake: number;     // 0..1
  steer: number;     // -1 (left) .. +1 (right)
}

/** The relevant slice of the server game-state for this player's bike. */
export interface ServerState {
  x: number;
  z: number;
  angle: number;
  speed: number;
  fallen: boolean;
  paused: boolean;
  lastSeq: number;   // last control seq the server applied
}
