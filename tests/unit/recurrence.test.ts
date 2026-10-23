import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkRecurrence, recurrenceFields } from '../../src/modules/tasks/domain/recurrence.js';

const schema = z.object(recurrenceFields).superRefine(checkRecurrence);
const accepts = (value: unknown) => schema.safeParse(value).success;

describe('checkRecurrence', () => {
  it('aceita tarefa sem repetição', () => {
    expect(accepts({})).toBe(true);
    expect(accepts({ recurrence: null, recurrenceDay: null })).toBe(true);
  });

  it('aceita diária sem dia e recusa diária com dia', () => {
    expect(accepts({ recurrence: 'daily' })).toBe(true);
    expect(accepts({ recurrence: 'daily', recurrenceDay: 3 })).toBe(false);
  });

  it('exige dia da semana entre 0 e 6 nas semanais', () => {
    expect(accepts({ recurrence: 'weekly', recurrenceDay: 0 })).toBe(true);
    expect(accepts({ recurrence: 'weekly', recurrenceDay: 7 })).toBe(false);
    expect(accepts({ recurrence: 'weekly' })).toBe(false);
  });

  it('exige dia do mês entre 1 e 31 nas mensais', () => {
    expect(accepts({ recurrence: 'monthly', recurrenceDay: 31 })).toBe(true);
    expect(accepts({ recurrence: 'monthly', recurrenceDay: 0 })).toBe(false);
  });

  it('recusa dia sem repetição', () => {
    expect(accepts({ recurrence: null, recurrenceDay: 5 })).toBe(false);
  });
});
