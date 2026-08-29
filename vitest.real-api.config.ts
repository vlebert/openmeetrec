import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Config à part pour `tests/manual/` : mêmes alias que `vite.config.ts`, mais
 * jamais lancée par `npm test` (celle-ci n'a pas `tests/unit/` dans `include`).
 * Séparée pour qu'un `include` plus large ne fasse jamais glisser un test
 * réseau/payant dans la CI par erreur.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/manual/**/*.manual.ts'],
    testTimeout: 10 * 60 * 1000,
  },
});
