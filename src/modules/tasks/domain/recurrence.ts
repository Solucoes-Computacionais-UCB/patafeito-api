import { z } from 'zod';

export const recurrence = z.enum(['daily', 'weekly', 'monthly']);
export type Recurrence = z.infer<typeof recurrence>;

/** Campos de repetição aceitos ao criar ou editar uma tarefa. */
export const recurrenceFields = {
  recurrence: recurrence.nullable().optional(),
  recurrenceDay: z.number().int().nullable().optional(),
  seriesId: z.string().uuid().nullable().optional(),
};

type RecurrenceInput = { recurrence?: Recurrence | null; recurrenceDay?: number | null };

/** Semanal exige o dia da semana (0 = domingo); mensal, o dia do mês; diária não leva dia. */
export function checkRecurrence(value: RecurrenceInput, context: z.RefinementCtx) {
  if (value.recurrence === undefined) return;
  const day = value.recurrenceDay ?? null;
  const valid = value.recurrence === 'weekly' ? day !== null && day >= 0 && day <= 6
    : value.recurrence === 'monthly' ? day !== null && day >= 1 && day <= 31
      : day === null;
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrenceDay'], message: 'Dia inválido para esta repetição.' });
}
