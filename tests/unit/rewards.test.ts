import { describe, expect, it } from 'vitest';
import { taskXp } from '../../src/modules/rewards/domain/rewards.js';

describe('taskXp', () => {
  it.each([['easy', 10], ['medium', 20], ['hard', 40]] as const)('%s concede %i XP', (difficulty, xp) => {
    expect(taskXp(difficulty)).toBe(xp);
  });
});
