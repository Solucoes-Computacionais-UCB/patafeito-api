import type { Difficulty } from '../../rewards/domain/rewards.js';

export type PetStats = { hunger: number; energy: number; happiness: number; statsUpdatedAt: Date };
export type StatsBoost = Partial<Record<'hunger' | 'energy' | 'happiness', number>>;

/**
 * Pontos perdidos por hora. Do cheio, a saciedade e a felicidade zeram em ~50h e a energia em ~67h.
 * Balanceado para quem cumpre a meta diária (3 tarefas médias + 2 ciclos de foco) manter o pato
 * com ~17 moedas por dia e ainda sobrar para a loja.
 */
export const DECAY_PER_HOUR = { hunger: 2, energy: 1.5, happiness: 2 };
/** Abaixo deste valor, fome ou energia aceleram a perda de felicidade. */
export const LOW_STAT_THRESHOLD = 30;
const LOW_STAT_PENALTY = 1.5;

export const FEED_COST_COINS = 5;
export const FEED_BOOST: StatsBoost = { hunger: 35, happiness: 2 };
export const FOCUS_BOOST: StatsBoost = { energy: 15, happiness: 3 };

/**
 * Mimar (Tela 6): tocar no pato. É o único cuidado gratuito: alimentar e curar usam itens da mochila,
 * comprados na loja, para que as moedas tenham um só destino.
 */
export const PAMPER_BOOST: StatsBoost = { happiness: 5 };
export const PAMPER_COOLDOWN_MS = 3_600_000;

export function canPamper(lastPamperedAt: Date | null, now: Date) {
  return !lastPamperedAt || now.getTime() - lastPamperedAt.getTime() >= PAMPER_COOLDOWN_MS;
}

export function nextPamperAt(lastPamperedAt: Date) {
  return new Date(lastPamperedAt.getTime() + PAMPER_COOLDOWN_MS);
}
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
