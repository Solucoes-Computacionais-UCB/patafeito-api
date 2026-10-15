export type Difficulty = 'easy' | 'medium' | 'hard';

/** RN01: recompensa de XP por dificuldade. Moedas aguardam definição de produto. */
export function taskXp(difficulty: Difficulty): number {
  return { easy: 10, medium: 20, hard: 40 }[difficulty];
}
