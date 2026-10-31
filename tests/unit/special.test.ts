import { describe, expect, it } from 'vitest';
import { weekBounds } from '../../src/modules/tasks/domain/special.js';
import { createTaskInput } from '../../src/modules/tasks/domain/task-input.js';

describe('weekBounds', () => {
  it('vai de segunda 00:00 a segunda seguinte 00:00 no horário de Brasília', () => {
    // Quinta, 29/10/2026 às 22:00 em Brasília (01:00 UTC de sexta).
    const { start, end } = weekBounds(new Date('2026-10-30T01:00:00Z'), 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2026-10-26T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });

  it('domingo à noite ainda pertence à semana que começou na segunda', () => {
    const { start } = weekBounds(new Date('2026-11-02T02:30:00Z'), 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2026-10-26T03:00:00.000Z');
  });

  it('segunda de madrugada abre a semana nova', () => {
    const { start } = weekBounds(new Date('2026-11-02T03:00:00Z'), 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });
});

describe('createTaskInput', () => {
  const base = { title: 'Show da banda', difficulty: 'easy' };

  it('aceita categoria, estimativa e tarefa especial', () => {
    expect(createTaskInput.parse({ ...base, category: 'study', estimatedMinutes: 30, kind: 'special' }))
      .toMatchObject({ category: 'study', estimatedMinutes: 30, kind: 'special' });
  });

  it('recusa tarefa especial recorrente', () => {
    expect(createTaskInput.safeParse({ ...base, kind: 'special', recurrence: 'daily' }).success).toBe(false);
  });

  it('exige dificuldade (RN10)', () => {
    expect(createTaskInput.safeParse({ title: 'Sem dificuldade' }).success).toBe(false);
  });

  it('sanitiza o título', () => {
    expect(createTaskInput.parse({ ...base, title: '  <b>Ler</b> ' }).title).toBe('bLer/b');
  });
});
