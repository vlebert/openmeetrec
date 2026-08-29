/**
 * `chrome.action.setIcon` accepte-t-il les chemins que le service worker lui
 * passe ?
 *
 * Un unitaire ne peut pas répondre : l'échec ne se voit qu'au runtime, dans un
 * vrai worker, où un chemin relatif est résolu depuis `background/` et non
 * depuis la racine de l'extension. Ça a valu une version où le badge REC
 * s'affichait sans que l'icône passe au rouge.
 */

import { expect, test } from '@playwright/test';
import { absoluteIcon, IDLE_ICON, RECORDING_ICON } from '../../src/shared/icons';
import { launchExtension, type LoadedExtension } from './fixtures/extension';

let ext: LoadedExtension;

test.beforeAll(async () => {
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
});

test('applique les deux jeux d icônes sans erreur', async () => {
  for (const icon of [IDLE_ICON, RECORDING_ICON]) {
    const outcome = await ext.worker.evaluate(async (paths: Record<string, string>) => {
      try {
        await chrome.action.setIcon({
          path: Object.fromEntries(
            Object.entries(paths).map(([size, path]) => [size, chrome.runtime.getURL(path)]),
          ),
        });
        return 'ok';
      } catch (error) {
        return String(error);
      }
    }, icon);
    expect(outcome).toBe('ok');
  }
});

test('refuse un chemin relatif, celui qui avait passé la revue', async () => {
  const outcome = await ext.worker.evaluate(async (path: string) => {
    try {
      await chrome.action.setIcon({ path: { '16': path } });
      return 'ok';
    } catch (error) {
      return String(error);
    }
  }, RECORDING_ICON['16']);
  expect(outcome, "si Chromium accepte désormais les chemins relatifs, l'absolutisation peut sauter").toContain(
    'Failed to set icon',
  );
});

test('les chemins absolutisés sont bien ceux du manifest, préfixés', async () => {
  const base = await ext.worker.evaluate(() => chrome.runtime.getURL(''));
  expect(absoluteIcon(RECORDING_ICON, (path) => `${base}${path}`)['128']).toBe(
    `${base}assets/icon-rec-128.png`,
  );
});
