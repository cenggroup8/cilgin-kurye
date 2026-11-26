// Demo recording in 30 Hz ticks. The transport adds its own state sequence on replay.
export const ticksPerSecond = 30;
export const recording = [
  { ticks: 90, phase: 'lobby', timeLeftSeconds: 18, scores: [0, 0, 0, 0] },
  { ticks: 90, phase: 'countdown', timeLeftSeconds: 18, scores: [0, 0, 0, 0] },
  { ticks: 120, phase: 'playing', timeLeftSeconds: 18, scores: [0, 0, 0, 0] },
  { ticks: 90, phase: 'playing', timeLeftSeconds: 14, scores: [10, 0, 0, 0],
    obstacles: [{ id: 1, type: 'road_work', segment: 12, lane: 0, pos: 0.5 }] },
  { ticks: 60, phase: 'playing', timeLeftSeconds: 11, scores: [10, 0, 0, 0], fallen: true },
  { ticks: 60, phase: 'paused', timeLeftSeconds: 9, scores: [10, 0, 0, 0] },
  { ticks: 90, phase: 'playing', timeLeftSeconds: 9, scores: [10, 5, 0, 0],
    quake: { mag: 6, zone: 4 } },
  { ticks: 180, phase: 'playing', timeLeftSeconds: 6, scores: [15, 5, 0, 0] },
  { ticks: 150, phase: 'ended', timeLeftSeconds: 0, scores: [15, 5, 0, 0], winners: [0] },
] as const;

export const recordingTicks = recording.reduce((sum, scene) => sum + scene.ticks, 0);

export function recordedState(tick: number) {
  let elapsed = tick % recordingTicks;
  for (const { ticks, ...state } of recording) {
    if (elapsed < ticks) {
      const timeLeftSeconds = state.phase === 'playing'
        ? state.timeLeftSeconds - Math.floor(elapsed / ticksPerSecond) : state.timeLeftSeconds;
      return {
        ...state,
        timeLeftSeconds,
        players: [{ id: 0, team: 0, x: 50 + elapsed / ticksPerSecond * 5, z: 7, heading: 90,
          fallen: 'fallen' in state, penaltySeconds: 'fallen' in state ? (ticks - elapsed) / ticksPerSecond : 0 }],
        npcCars: [{ id: 0, x: 50 + elapsed / ticksPerSecond * 4, z: 3.5, heading: 90 }],
        compassTarget: { x: 150, z: 7 },
        findMeWaitSeconds: 0,
        countdownTicksLeft: state.phase === 'countdown' ? ticks - elapsed : undefined,
      };
    }
    elapsed -= ticks;
  }
  throw new RangeError('Invalid recording tick');
}
