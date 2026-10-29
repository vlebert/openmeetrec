/**
 * Lancement de Chromium avec l'extension chargée.
 *
 * On charge `dist-test/`, pas `dist/` : ce build substitue la stratégie de
 * capture (activeTab inaccessible en automatisation) et raccourcit les chunks.
 * Voir `vite.config.ts`.
 */

import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distTest = fileURLToPath(new URL('../../../dist-test', import.meta.url));

export interface LoadedExtension {
  context: BrowserContext;
  worker: Worker;
  /** Identifiant attribué par Chromium au chargement. */
  id: string;
}

/**
 * Autorisation micro de l'extension au lancement :
 * - `granted` : demandes acceptées d'office (`--use-fake-ui-for-media-stream`) ;
 * - `prompt` : premier lancement d'un utilisateur, rien d'accordé ;
 * - `denied` : micro bloqué dans les réglages de Chrome, posé dans le profil.
 */
export type MicPermissionSetup = 'granted' | 'prompt' | 'denied';

export async function launchExtension(
  { micPermission = 'granted' }: { micPermission?: MicPermissionSetup } = {},
): Promise<LoadedExtension> {
  const userDataDir = micPermission === 'denied' ? await profileWithMicBlocked() : '';
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(process.env['OMR_CHROMIUM'] ? { executablePath: process.env['OMR_CHROMIUM'] } : {}),
    args: [
      `--disable-extensions-except=${distTest}`,
      `--load-extension=${distTest}`,
      // Micro servi par le périphérique factice (un bip).
      '--use-fake-device-for-media-stream',
      ...(micPermission === 'granted' ? ['--use-fake-ui-for-media-stream'] : []),
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return { context, worker, id };
}

/**
 * Profil neuf où le micro est bloqué pour l'extension, comme après un clic sur
 * « Bloquer ». L'identifiant d'une extension non empaquetée dérive de son
 * chemin : SHA-256 du chemin absolu, 32 premiers chiffres hexadécimaux
 * transposés en a–p.
 */
async function profileWithMicBlocked(): Promise<string> {
  const hex = createHash('sha256').update(await realpath(distTest)).digest('hex').slice(0, 32);
  const id = [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  const dir = await mkdtemp(join(tmpdir(), 'omr-profile-'));
  await mkdir(join(dir, 'Default'));
  const preferences = {
    profile: {
      content_settings: {
        exceptions: { media_stream_mic: { [`chrome-extension://${id}/,*`]: { setting: 2 } } },
      },
    },
  };
  await writeFile(join(dir, 'Default', 'Preferences'), JSON.stringify(preferences));
  return dir;
}

export function extensionUrl(id: string, path: string): string {
  return `chrome-extension://${id}/${path}`;
}
