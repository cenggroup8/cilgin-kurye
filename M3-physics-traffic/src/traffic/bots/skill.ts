/**
 * "Bot skill" (M5 parameter, through M1): one number from 0 to 1 that sets how
 * well a bot drives. 0 is a slow, late and shaky rider, 1 is a fast, quick and
 * steady one. The three values below can also be set one by one.
 */
export interface BotSkill {
  /** Top speed the bot aims for, m/s. */
  maxSpeedMps: number;
  /** Delay between what the bot sees and what it does, seconds. */
  reactionS: number;
  /** Standard deviation of the random steer added each tick, in steer units (-1 to 1). */
  steerNoise: number;
}

export const WORST_SKILL: BotSkill = { maxSpeedMps: 7, reactionS: 0.6, steerNoise: 0.25 };
export const BEST_SKILL: BotSkill = { maxSpeedMps: 16, reactionS: 0.05, steerNoise: 0.01 };

/** Turns the 0-1 skill value into the three values. Out of range is clamped. */
export function skillFromLevel(level: number): BotSkill {
  const k = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0.5;
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    maxSpeedMps: mix(WORST_SKILL.maxSpeedMps, BEST_SKILL.maxSpeedMps),
    reactionS: mix(WORST_SKILL.reactionS, BEST_SKILL.reactionS),
    steerNoise: mix(WORST_SKILL.steerNoise, BEST_SKILL.steerNoise),
  };
}

export function checkSkill(skill: BotSkill): BotSkill {
  if (!(skill.maxSpeedMps > 0) || !(skill.reactionS >= 0) || !(skill.steerNoise >= 0)) {
    throw new RangeError('Invalid bot skill');
  }
  return skill;
}
