/**
 * Lancement de Chromium avec l'extension chargée.
 *
 * On charge `dist-test/`, pas `dist/` : ce build substitue la stratégie de
 * capture (activeTab inaccessible en automatisation) et raccourcit les chunks.
 * Voir `vite.config.ts`.
 */

import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const distTest = fileURLToPath(new URL('../../../dist-test', import.meta.url));

export interface LoadedExtension {
  context: BrowserContext;
  worker: Worker;
  /** Identifiant attribué par Chromium au chargement. */
  id: string;
}

export async function launchExtension(): Promise<LoadedExtension> {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    ...(process.env['OMR_CHROMIUM'] ? { executablePath: process.env['OMR_CHROMIUM'] } : {}),
    args: [
      `--disable-extensions-except=${distTest}`,
      `--load-extension=${distTest}`,
      // Micro et « onglet » servis par le périphérique factice, sans prompt.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return { context, worker, id };
}

export function extensionUrl(id: string, path: string): string {
  return `chrome-extension://${id}/${path}`;
}
