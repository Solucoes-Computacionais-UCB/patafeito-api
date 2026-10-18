import { describe, expect, it } from 'vitest';
import { levelForXp } from '../../src/modules/pets/domain/progression.js';

describe('levelForXp', () => {
  it.each([[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [600, 4]])('atribui nível %i para %i XP', (xp, level) => {
    expect(levelForXp(xp)).toBe(level);
  });
});
