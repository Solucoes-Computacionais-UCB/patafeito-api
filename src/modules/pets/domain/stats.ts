import type { Difficulty } from '../../rewards/domain/rewards.js';

export type PetStats = { hunger: number; energy: number; happiness: number; statsUpdatedAt: Date };
export type StatsBoost = Partial<Record<'hunger' | 'energy' | 'happiness', number>>;

/** Pontos perdidos por hora. A fome zera em ~25h, a energia em ~50h e a felicidade em ~33h. */
export const DECAY_PER_HOUR = { hunger: 4, energy: 2, happiness: 3 };
/** Abaixo deste valor, fome ou energia aceleram a perda de felicidade. */
export const LOW_STAT_THRESHOLD = 30;
const LOW_STAT_PENALTY = 1.5;

export const FEED_COST_COINS = 5;
export const FEED_BOOST: StatsBoost = { hunger: 35, happiness: 2 };
export const FOCUS_BOOST: StatsBoost = { energy: 15, happiness: 3 };
const taskHappiness: Record<Difficulty, number> = { easy: 5, medium: 8, hard: 12 };

export function taskBoost(difficulty: Difficulty): StatsBoost {
  return { happiness: taskHappiness[difficulty] };
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Aplica o tempo decorrido desde `statsUpdatedAt`. Função pura: o mesmo cálculo roda no app
 * para projetar as barras sem rede. A penalidade da felicidade usa os valores já decaídos,
 * uma aproximação suficiente para a cadência do jogo.
 */
export function decayStats(stats: PetStats, now: Date): PetStats {
  const hours = (now.getTime() - stats.statsUpdatedAt.getTime()) / 3_600_000;
  if (hours <= 0) return stats;
  const hunger = clamp(stats.hunger - DECAY_PER_HOUR.hunger * hours);
  const energy = clamp(stats.energy - DECAY_PER_HOUR.energy * hours);
  const penalty = (hunger < LOW_STAT_THRESHOLD ? LOW_STAT_PENALTY : 1) * (energy < LOW_STAT_THRESHOLD ? LOW_STAT_PENALTY : 1);
  const happiness = clamp(stats.happiness - DECAY_PER_HOUR.happiness * penalty * hours);
  return { hunger, energy, happiness, statsUpdatedAt: now };
}

export function applyBoost(stats: PetStats, boost: StatsBoost, sign: 1 | -1 = 1): PetStats {
  return {
    hunger: clamp(stats.hunger + sign * (boost.hunger ?? 0)),
    energy: clamp(stats.energy + sign * (boost.energy ?? 0)),
    happiness: clamp(stats.happiness + sign * (boost.happiness ?? 0)),
    statsUpdatedAt: stats.statsUpdatedAt,
  };
}

/** Status a gravar numa escrita do pet: decai até `now` e soma (ou estorna) o bônus. */
export function nextStats(pet: PetStats, now: Date, boost: StatsBoost = {}, sign: 1 | -1 = 1): PetStats {
  return applyBoost(decayStats(pet, now), boost, sign);
}
