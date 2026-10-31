import { describe, expect, it } from 'vitest';
import { currentStreak, streakBonus, streakEndingOn } from '../../src/modules/rewards/domain/streak.js';
import { deterministicUuid } from '../../src/shared/ids/deterministic-uuid.js';
import { addDays, localDateKey, localHour } from '../../src/shared/time/zoned.js';

const days = new Set(['2026-10-27', '2026-10-28', '2026-10-29']);

describe('sequência (RN07)', () => {
  it('conta os dias seguidos até a data', () => {
    expect(streakEndingOn(days, '2026-10-29')).toBe(3);
    expect(streakEndingOn(days, '2026-10-30')).toBe(0);
  });

  it('hoje sem atividade ainda mantém a sequência de ontem', () => {
    expect(currentStreak(days, '2026-10-30')).toBe(3);
    expect(currentStreak(days, '2026-10-31')).toBe(0);
  });

  it('paga bônus no 3º dia e a cada 7', () => {
    expect([1, 2, 3, 4, 7, 10, 14, 21].map((streak) => streakBonus(streak))).toEqual([
      null, null, { xp: 10, coins: 5 }, null, { xp: 30, coins: 15 }, null, { xp: 30, coins: 15 }, { xp: 30, coins: 15 },
    ]);
  });
});

describe('utilitários de data e id', () => {
  it('soma dias atravessando meses', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('usa a data e a hora locais do fuso', () => {
    const instant = new Date('2026-10-31T01:30:00Z');
    expect(localDateKey(instant, 'America/Sao_Paulo')).toBe('2026-10-30');
    expect(localHour(instant, 'America/Sao_Paulo')).toBe(22);
  });

  it('gera o mesmo UUID para o mesmo texto', () => {
    const id = deterministicUuid('streak_bonus:user:2026-10-30');
    expect(id).toBe(deterministicUuid('streak_bonus:user:2026-10-30'));
    expect(id).not.toBe(deterministicUuid('streak_bonus:user:2026-10-31'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
