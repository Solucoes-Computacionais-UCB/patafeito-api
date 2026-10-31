import { describe, expect, it } from 'vitest';
import { moodFor, pendingInactivityWindows, type MoodInput } from '../../src/modules/pets/domain/mood.js';
import { canPamper, nextPamperAt, nextStats, PAMPER_BOOST } from '../../src/modules/pets/domain/stats.js';
import { dayBounds } from '../../src/shared/time/zoned.js';

const now = new Date('2026-10-30T15:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const base: MoodInput = { hunger: 80, energy: 80, happiness: 80, overdueStreak: 0, lastActivityAt: hoursAgo(2), createdAt: hoursAgo(100) };
const goalMet = { targetXp: 60, earnedXp: 60 };
const goalMissed = { targetXp: 60, earnedXp: 20 };

describe('moodFor', () => {
  it('fica feliz com a meta do dia cumprida e felicidade alta (RN13)', () => {
    expect(moodFor(base, now, goalMet)).toBe('happy');
  });

  it('fica neutro abaixo da meta, sem regra negativa', () => {
    expect(moodFor(base, now, goalMissed)).toBe('neutral');
  });

  it('fica triste com 3 tarefas vencidas seguidas (RN02), mesmo com a meta cumprida', () => {
    expect(moodFor({ ...base, overdueStreak: 2 }, now, goalMet)).toBe('happy');
    expect(moodFor({ ...base, overdueStreak: 3 }, now, goalMet)).toBe('sad');
  });

  it('fica triste depois de mais de 24h sem atividade (RN11)', () => {
    expect(moodFor({ ...base, lastActivityAt: hoursAgo(23) }, now, goalMissed)).toBe('neutral');
    expect(moodFor({ ...base, lastActivityAt: hoursAgo(25) }, now, goalMissed)).toBe('sad');
    expect(moodFor({ ...base, lastActivityAt: null, createdAt: hoursAgo(30) }, now, goalMissed)).toBe('sad');
  });

  it('abatido vence as demais regras quando algum status está muito baixo', () => {
    expect(moodFor({ ...base, hunger: 10 }, now, goalMet)).toBe('down');
  });
});

describe('pendingInactivityWindows', () => {
  it('conta cada janela de 24h uma única vez', () => {
    const last = hoursAgo(50);
    expect(pendingInactivityWindows(last, null, now)).toBe(2);
    expect(pendingInactivityWindows(last, now, now)).toBe(0);
    // Punido às 47h (1 janela); 24h depois já são 74h: faltam as janelas de 48h e 72h.
    expect(pendingInactivityWindows(last, hoursAgo(3), new Date(now.getTime() + 24 * 3_600_000))).toBe(2);
  });

  it('ignora punição anterior à última atividade', () => {
    expect(pendingInactivityWindows(hoursAgo(30), hoursAgo(40), now)).toBe(1);
  });
});

describe('mimar', () => {
  const stats = { hunger: 50, energy: 50, happiness: 50, statsUpdatedAt: now };

  it('é grátis e dá +5 de felicidade', () => {
    expect(nextStats(stats, now, PAMPER_BOOST)).toMatchObject({ happiness: 55, energy: 50, hunger: 50 });
  });

  it('conta no máximo uma vez por hora', () => {
    expect(canPamper(null, now)).toBe(true);
    expect(canPamper(hoursAgo(0.5), now)).toBe(false);
    expect(canPamper(hoursAgo(1), now)).toBe(true);
    expect(nextPamperAt(now).getTime() - now.getTime()).toBe(3_600_000);
  });
});

describe('dayBounds', () => {
  it('vai da meia-noite à meia-noite de Brasília', () => {
    const { start, end } = dayBounds(new Date('2026-10-31T01:30:00Z'), 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2026-10-30T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T03:00:00.000Z');
  });
});
