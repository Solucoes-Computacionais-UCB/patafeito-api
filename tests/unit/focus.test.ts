import { describe, expect, it } from 'vitest';
import { isFullPomodoro, POMODORO_DURATION_SECONDS } from '../../src/modules/focus/application/complete-focus-session.js';

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
