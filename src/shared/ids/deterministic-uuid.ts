import { createHash } from 'node:crypto';

/** UUID (formato v5) derivado de um texto: o mesmo texto gera sempre o mesmo id. Serve de chave idempotente. */
export function deterministicUuid(text: string) {
  const hash = createHash('sha1').update(text).digest('hex');
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
