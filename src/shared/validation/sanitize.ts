import { z } from 'zod';

/** Caracteres de controle (exceto tab e quebras de linha) e os sinais `<` `>`, que abririam marcação. */
function isUnsafe(char: string) {
  const code = char.codePointAt(0)!;
  if (char === '<' || char === '>' || code === 0x7f) return true;
  return code < 0x20 && char !== '\t' && char !== '\n' && char !== '\r';
}

/** Normaliza para NFC e remove o que não deve ser guardado nem exibido (RNF04). */
export function cleanText(value: string) {
  return [...value.normalize('NFC')].filter((char) => !isUnsafe(char)).join('').trim();
}

/** Comprimento percebido pelo usuário: um emoji ou letra acentuada conta como um caractere. */
export function graphemeLength(value: string) {
  return [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(value)].length;
}

/** Texto livre já sanitizado, com limites em graphemes. */
export function safeText(min: number, max: number) {
  return z.string().transform(cleanText).refine((value) => {
    const length = graphemeLength(value);
    return length >= min && length <= max;
  }, `Use entre ${min} e ${max} caracteres.`);
}
