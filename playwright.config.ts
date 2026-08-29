import { defineConfig } from '@playwright/test';

/**
 * Tests d'intégration : Chromium headful sur un display X existant
 * (`DISPLAY=:1` sur la machine de dev), extension chargée non empaquetée.
 * Une session complète dure ~1 min, d'où le timeout large et l'absence de
 * parallélisme — un seul enregistrement à la fois de toute façon (F-CAP-08).
 */
export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
});
