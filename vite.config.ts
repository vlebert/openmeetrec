import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const entry = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));
const local = (path: string) => fileURLToPath(new URL(`./${path}`, import.meta.url));

/**
 * Build d'intégration : même code, deux modules substitués.
 *
 * - la stratégie de capture, parce que `activeTab` ne peut pas être accordé par
 *   automatisation (architecture §10.3) ;
 * - les durées de chunk, pour ne pas faire durer un test cinq minutes.
 *
 * La substitution se fait ici, au niveau du build : aucun code de test ne part
 * dans l'extension distribuée.
 */
const isTestBuild = process.env['OMR_TEST_BUILD'] === '1';

const testAliases = {
  '@/capture/tabCaptureStrategy': local('tests/integration/fixtures/fakeCaptureStrategy.ts'),
  '@/audio/chunkOptions': local('tests/integration/fixtures/fastChunkOptions.ts'),
};

// Build MV3 : un bundle ESM par point d'entrée, sans hash (le manifest référence
// des chemins fixes). Les .html et le manifest sont copiés par scripts/build.mjs.
export default defineConfig({
  resolve: {
    alias: {
      ...(isTestBuild ? testAliases : {}),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: isTestBuild ? 'dist-test' : 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        'background/service-worker': entry('background/service-worker.ts'),
        'offscreen/offscreen': entry('offscreen/offscreen.ts'),
        'ui/popup': entry('ui/popup.ts'),
        'ui/record': entry('ui/record.ts'),
        'ui/options': entry('ui/options.ts'),
        'ui/mic-permission': entry('ui/mic-permission.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
