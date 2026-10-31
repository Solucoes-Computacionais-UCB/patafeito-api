import { z } from 'zod';

/** @usuário: 3 a 20 caracteres, só letras minúsculas sem acento, números e "_". */
export const handleSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, 'Use de 3 a 20 letras minúsculas, números ou _.');

/** Base do @usuário a partir do nome: sem acentos, só a-z e 0-9, até 14 caracteres. */
export function handleBase(displayName: string) {
  const base = displayName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14);
  return base.length >= 3 ? base : 'pato';
}

/** Candidato com sufixo aleatório de 4 dígitos; quem chama tenta de novo se já existir. */
export function handleCandidate(displayName: string, random = Math.random) {
  return `${handleBase(displayName)}_${String(Math.floor(random() * 10_000)).padStart(4, '0')}`;
}
