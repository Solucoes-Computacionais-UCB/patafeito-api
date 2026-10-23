import { describe, expect, it } from 'vitest';
import { taskCoins, taskXp } from '../../src/modules/rewards/domain/rewards.js';

describe('taskXp', () => {
  it.each([['easy', 10], ['medium', 20], ['hard', 40]] as const)('%s concede %i XP', (difficulty, xp) => {
    expect(taskXp(difficulty)).toBe(xp);
  });
});

describe('taskCoins', () => {
  it.each([['easy', 1], ['medium', 2], ['hard', 3]] as const)('%s concede %i moeda(s)', (difficulty, coins) => {
    expect(taskCoins(difficulty)).toBe(coins);
  });
});
