import { describe, expect, it } from 'vitest';
import { focusRewards, isFullPomodoro, POMODORO_DURATION_SECONDS } from '../../src/modules/focus/application/complete-focus-session.js';

describe('isFullPomodoro', () => {
  const startedAt = new Date('2026-10-22T10:00:00.000Z');

  it('recusa uma sessão interrompida antes da duração-alvo', () => {
    expect(isFullPomodoro(startedAt, new Date(startedAt.getTime() + (POMODORO_DURATION_SECONDS - 1) * 1000))).toBe(false);
  });

  it('aceita a sessão exatamente na duração-alvo', () => {
    expect(isFullPomodoro(startedAt, new Date(startedAt.getTime() + POMODORO_DURATION_SECONDS * 1000))).toBe(true);
  });

  it('aceita uma sessão mais longa que a duração-alvo', () => {
    expect(isFullPomodoro(startedAt, new Date(startedAt.getTime() + 30 * 60 * 1000))).toBe(true);
  });
});

describe('focusRewards', () => {
  it('mantém 20 XP e 5 moedas no ciclo clássico', () => {
    expect(focusRewards(25 * 60)).toEqual({ xp: 20, coins: 5 });
  });

  it('escala com a duração dos ciclos curto e longo', () => {
    expect(focusRewards(15 * 60)).toEqual({ xp: 12, coins: 3 });
    expect(focusRewards(50 * 60)).toEqual({ xp: 40, coins: 10 });
  });
});
