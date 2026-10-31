import { describe, expect, it } from 'vitest';
import { cleanText, graphemeLength, safeText } from '../../src/shared/validation/sanitize.js';

describe('cleanText', () => {
  it('remove marcação e caracteres de controle, mantendo quebras de linha', () => {
    expect(cleanText('  <script>alert(1)</script>\u0000Oi\nTudo bem?  ')).toBe('scriptalert(1)/scriptOi\nTudo bem?');
  });

  it('normaliza acentos para NFC', () => {
    expect(cleanText('João')).toBe('João');
  });
});

describe('safeText', () => {
  const petName = safeText(2, 15);

  it('conta emojis e letras acentuadas como um caractere', () => {
    expect(graphemeLength('Pé🦆')).toBe(3);
    expect(petName.parse('🦆🦆')).toBe('🦆🦆');
  });

  it('recusa nomes que ficam curtos depois de sanitizados', () => {
    expect(petName.safeParse('<>a').success).toBe(false);
    expect(petName.safeParse('a'.repeat(16)).success).toBe(false);
  });
});
