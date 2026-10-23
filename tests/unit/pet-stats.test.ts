import { describe, expect, it } from 'vitest';
import { applyBoost, decayStats, nextStats, type PetStats } from '../../src/modules/pets/domain/stats.js';

const start = new Date('2026-10-22T10:00:00.000Z');
const full: PetStats = { hunger: 100, energy: 100, happiness: 100, statsUpdatedAt: start };
const hoursLater = (hours: number) => new Date(start.getTime() + hours * 3_600_000);

describe('decayStats', () => {
  it('perde pontos proporcionais às horas decorridas', () => {
    expect(decayStats(full, hoursLater(5))).toEqual({ hunger: 80, energy: 90, happiness: 85, statsUpdatedAt: hoursLater(5) });
  });

  it('não altera nada quando o relógio não avançou', () => {
    expect(decayStats(full, start)).toBe(full);
    expect(decayStats(full, hoursLater(-1))).toBe(full);
  });

  it('nunca passa de zero', () => {
    expect(decayStats(full, hoursLater(500))).toMatchObject({ hunger: 0, energy: 0, happiness: 0 });
  });

  it('acelera a perda de felicidade quando a fome está baixa', () => {
    const hungry = { ...full, hunger: 20 };
    expect(decayStats(hungry, hoursLater(2)).happiness).toBe(91);
    expect(decayStats(full, hoursLater(2)).happiness).toBe(94);
  });
});

describe('applyBoost', () => {
  it('soma e limita a 100', () => {
    expect(applyBoost({ ...full, hunger: 80 }, { hunger: 35, happiness: 2 })).toMatchObject({ hunger: 100, happiness: 100 });
  });

  it('estorna sem ficar negativo', () => {
    expect(applyBoost({ ...full, happiness: 4 }, { happiness: 12 }, -1).happiness).toBe(0);
  });
});

describe('nextStats', () => {
  it('decai até agora antes de aplicar o bônus e avança o relógio', () => {
    expect(nextStats(full, hoursLater(10), { hunger: 35 })).toEqual({ hunger: 95, energy: 80, happiness: 70, statsUpdatedAt: hoursLater(10) });
  });
});
