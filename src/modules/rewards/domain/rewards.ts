export type Difficulty = 'easy' | 'medium' | 'hard';

/** RN01: recompensa de XP por dificuldade. */
export function taskXp(difficulty: Difficulty): number {
  return { easy: 10, medium: 20, hard: 40 }[difficulty];
}

/** Moedas por tarefa concluída: 1 fácil, 2 média, 3 difícil. */
export function taskCoins(difficulty: Difficulty): number {
  return { easy: 1, medium: 2, hard: 3 }[difficulty];
}
