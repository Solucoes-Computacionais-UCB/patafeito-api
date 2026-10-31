import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // RNF011: a meta de 80% vale para as camadas de domínio e de serviço (regras de XP, recorrência, sequência...).
      include: ['src/modules/**/domain/**', 'src/modules/**/application/**'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
});
