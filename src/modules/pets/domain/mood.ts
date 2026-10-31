/**
 * Humor do pato, derivado dos status e do comportamento recente (RN02, RN11, RN13).
 * Não é gravado: é recalculado a cada leitura, aqui e no app (espelho em features/pet/domain/emotion.ts).
 */
export type Mood = 'happy' | 'neutral' | 'sad' | 'down';

export const MOOD_LABEL: Record<Mood, string> = { happy: 'Feliz', neutral: 'Neutro', sad: 'Triste', down: 'Abatido' };

/** RN02: felicidade perdida por tarefa vencida e quantas seguidas deixam o pato triste. */
export const OVERDUE_PENALTY = 5;
export const OVERDUE_SAD_STREAK = 3;
/** RN11: horas sem concluir tarefa ou foco até o pato ficar triste, e a perda a cada janela dessas. */
export const INACTIVITY_HOURS = 24;
export const INACTIVITY_PENALTY = 10;
/** RN13: meta diária padrão, em XP de tarefas (3 tarefas médias). */
export const DEFAULT_DAILY_GOAL_XP = 60;
/** Faixas de felicidade: abaixo de 30 entristece; a partir de 70, com a meta cumprida, alegra. */
export const SAD_HAPPINESS = 30;
export const HAPPY_HAPPINESS = 70;
/** Qualquer status abaixo disto deixa o pato abatido, acima das demais regras. */
export const DOWN_STAT = 15;

export type MoodInput = {
  hunger: number;
  energy: number;
  happiness: number;
  overdueStreak: number;
  lastActivityAt: Date | null;
  createdAt: Date;
};

export type DailyGoal = { targetXp: number; earnedXp: number };

const HOUR_MS = 3_600_000;

export function inactiveHours(input: Pick<MoodInput, 'lastActivityAt' | 'createdAt'>, now: Date) {
  return (now.getTime() - (input.lastActivityAt ?? input.createdAt).getTime()) / HOUR_MS;
}

/** Prioridade: abatido > triste > feliz > neutro. */
export function moodFor(input: MoodInput, now: Date, goal: DailyGoal): Mood {
  if (Math.min(input.hunger, input.energy, input.happiness) < DOWN_STAT) return 'down';
  if (input.overdueStreak >= OVERDUE_SAD_STREAK || inactiveHours(input, now) > INACTIVITY_HOURS || input.happiness < SAD_HAPPINESS) return 'sad';
  if (goal.earnedXp >= goal.targetXp && input.happiness >= HAPPY_HAPPINESS) return 'happy';
  return 'neutral';
}

/**
 * Janelas de 24h de inatividade ainda não punidas (RN11).
 * `penalizedAt` anterior à última atividade não conta: a pessoa voltou e a contagem recomeçou.
 */
export function pendingInactivityWindows(lastActivity: Date, penalizedAt: Date | null, now: Date) {
  const windowMs = INACTIVITY_HOURS * HOUR_MS;
  const elapsed = Math.floor((now.getTime() - lastActivity.getTime()) / windowMs);
  const done = penalizedAt && penalizedAt > lastActivity ? Math.floor((penalizedAt.getTime() - lastActivity.getTime()) / windowMs) : 0;
  return Math.max(0, elapsed - done);
}
