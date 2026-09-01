/**
 * Rappel d'enregistrement dans un vrai Chromium.
 *
 * Ce que les tests unitaires ne peuvent pas couvrir : que la permission `tabs`
 * délivre bien l'URL au service worker, et que la notification est réellement
 * créée puis retirée. La reconnaissance d'URL elle-même est testée à part
 * (`tests/unit/meetingPatterns.test.ts`).
 */

import { expect, test, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { launchExtension, type LoadedExtension } from './fixtures/extension';
import { startMockApi, type MockApi } from './fixtures/mockApi';

const MEETING_PAGE = fileURLToPath(new URL('./fixtures/meeting-page.html', import.meta.url));

/** Le serveur de test répond sur `localhost` : le port ne fait pas partie de l'hôte comparé. */
const PATTERN = 'localhost/meeting*';

let api: MockApi;
let ext: LoadedExtension;

test.beforeAll(async () => {
  api = await startMockApi(MEETING_PAGE);
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.context.close();
  await api?.close();
});

test('notifie à l ouverture d une page de visio, et retire le rappel en sortant', async () => {
  await setReminder(ext.worker, { enabled: true, patterns: [PATTERN] });

  const tab = await ext.context.newPage();
  await tab.goto(`${api.url}/meeting`);

  await expect
    .poll(() => notificationIds(ext.worker), { message: 'notification attendue' })
    .toHaveLength(1);
  const [id] = await notificationIds(ext.worker);
  expect(id).toMatch(/^meeting:\d+$/);

  // L'onglet quitte la visio : le rappel n'a plus lieu d'être.
  await tab.goto(`${api.url}/ailleurs`);
  await expect.poll(() => notificationIds(ext.worker)).toHaveLength(0);

  await tab.close();
});

test('ne notifie pas quand l option est décochée', async () => {
  await setReminder(ext.worker, { enabled: false, patterns: [PATTERN] });

  const tab = await ext.context.newPage();
  await tab.goto(`${api.url}/meeting`);
  await tab.waitForTimeout(1000);

  expect(await notificationIds(ext.worker)).toHaveLength(0);
  await tab.close();
});

test('ne notifie pas sur une page hors liste', async () => {
  await setReminder(ext.worker, { enabled: true, patterns: ['visio.example.test/*'] });

  const tab = await ext.context.newPage();
  await tab.goto(`${api.url}/meeting`);
  await tab.waitForTimeout(1000);

  expect(await notificationIds(ext.worker)).toHaveLength(0);
  await tab.close();
});

async function setReminder(
  worker: Worker,
  settings: { enabled: boolean; patterns: string[] },
): Promise<void> {
  await worker.evaluate(async ({ enabled, patterns }) => {
    const stored = (await chrome.storage.local.get('config'))['config'] as
      | Record<string, unknown>
      | undefined;
    await chrome.storage.local.set({
      config: { ...stored, meetingReminder: enabled, meetingPatterns: patterns },
    });
    // Repartir d'une ardoise vierge : le service worker ne renotifie pas un
    // onglet déjà signalé, et `storage.session` survit d'un test à l'autre.
    await chrome.storage.session.remove('meetingNotified');
    for (const notification of Object.keys(await chrome.notifications.getAll())) {
      await chrome.notifications.clear(notification);
    }
  }, settings);
}

async function notificationIds(worker: Worker): Promise<string[]> {
  return worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));
}
