export type Difficulty = 'easy' | 'medium' | 'hard';

/** RN01: recompensa de XP por dificuldade. */
export function taskXp(difficulty: Difficulty): number {
  return { easy: 10, medium: 20, hard: 40 }[difficulty];
}

/** Moedas por tarefa concluída: 2 fácil, 3 média, 5 difícil. */
export function taskCoins(difficulty: Difficulty): number {
  return { easy: 2, medium: 3, hard: 5 }[difficulty];
}
