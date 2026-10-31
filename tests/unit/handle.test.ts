import { describe, expect, it } from 'vitest';
import { handleBase, handleCandidate, handleSchema } from '../../src/modules/social/domain/handle.js';
import { relationFor } from '../../src/modules/social/application/friends.js';

describe('@usuário', () => {
  it('deriva do nome sem acentos nem espaços', () => {
    expect(handleBase('João Victor Campos')).toBe('joaovictorcamp');
    expect(handleBase('Lu')).toBe('pato');
    expect(handleCandidate('Mariana', () => 0.0421)).toBe('mariana_0421');
  });

  it('aceita só minúsculas, números e _ entre 3 e 20 caracteres', () => {
    expect(handleSchema.parse('  Ana_Paula ')).toBe('ana_paula');
    expect(handleSchema.safeParse('ab').success).toBe(false);
    expect(handleSchema.safeParse('com espaço').success).toBe(false);
    expect(handleSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });
});

describe('relationFor', () => {
  const pair = (status: string, requesterId = 'a') => ({ id: 'f', requesterId, addresseeId: requesterId === 'a' ? 'b' : 'a', status, createdAt: new Date(), respondedAt: null });

  it('distingue amigo, pedido enviado, recebido e recusado', () => {
    expect(relationFor('a', 'a', undefined)).toBe('self');
    expect(relationFor('a', 'b', undefined)).toBe('none');
    expect(relationFor('a', 'b', pair('accepted'))).toBe('friend');
    expect(relationFor('a', 'b', pair('pending'))).toBe('outgoing');
    expect(relationFor('a', 'b', pair('pending', 'b'))).toBe('incoming');
    expect(relationFor('a', 'b', pair('declined'))).toBe('none');
  });
});
