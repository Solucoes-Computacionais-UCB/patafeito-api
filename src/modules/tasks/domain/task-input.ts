import { z } from 'zod';
import { cleanText } from '../../../shared/validation/sanitize.js';
import { checkRecurrence, recurrenceFields } from './recurrence.js';

export const difficulty = z.enum(['easy', 'medium', 'hard']);
export const category = z.enum(['personal', 'work', 'study', 'health', 'career']);
export const taskKind = z.enum(['normal', 'special']);
export type TaskCategory = z.infer<typeof category>;
export type TaskKind = z.infer<typeof taskKind>;

const title = z.string().transform(cleanText).pipe(z.string().min(1).max(200));
const description = z.string().transform(cleanText).pipe(z.string().max(2000)).nullable().optional();

/** Campos editáveis de uma tarefa. O tipo (normal/especial) só é escolhido na criação. */
const editableFields = z.object({
  title,
  description,
  difficulty,
  category: category.optional(),
  estimatedMinutes: z.number().int().min(1).max(600).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  ...recurrenceFields,
});

/** Tarefa especial é um evento único: não se repete (RN14). */
function checkSpecial(value: { kind?: TaskKind; recurrence?: string | null }, context: z.RefinementCtx) {
  if (value.kind === 'special' && value.recurrence) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrence'], message: 'Uma tarefa especial não pode ser recorrente.' });
  }
}

export const createTaskInput = editableFields.extend({ kind: taskKind.optional() })
  .superRefine(checkRecurrence).superRefine(checkSpecial);
export const updateTaskInput = editableFields.partial()
  .refine((input) => Object.keys(input).length > 0, 'Informe ao menos um campo para atualizar.')
  .superRefine(checkRecurrence);
