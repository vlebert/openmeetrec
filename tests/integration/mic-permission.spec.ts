/**
 * Parcours d'autorisation du micro, tel que le vit un nouvel utilisateur.
 *
 * Les autres tests accordent le micro d'office (`--use-fake-ui-for-media-stream`) :
 * sans ceux-ci, rien n'exerçait le cas où l'autorisation manque ou a été
 * refusée. Non couvert : cliquer « Autoriser » dans la demande de Chrome, qui
 * fait partie de l'UI du navigateur — d'où le test de l'erreur périmée, qui
 * reproduit l'état laissé par un échec puis vérifie qu'une autorisation
 * accordée l'efface.
 */

import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { extensionUrl, launchExtension, type LoadedExtension, type MicPermissionSetup } from './fixtures/extension';
import { startMockApi, type MockApi } from './fixtures/mockApi';

const MEETING_PAGE = fileURLToPath(new URL('./fixtures/meeting-page.html', import.meta.url));

let api: MockApi;

test.beforeAll(async () => {
  api = await startMockApi(MEETING_PAGE);
});

test.afterAll(async () => {
  await api?.close();
});

test.describe('premier lancement, micro jamais autorisé', () => {
  const ctx = useExtension('prompt');

  test('prévient avant Start, explique l’échec et mène à la page d’autorisation', async () => {
    const { ext, tabId } = await openMeeting(ctx());
    const popup = await openPopup(ext);

    // Prévenu dès l'ouverture, sans attendre d'échouer.
    await expect(popup.locator('#mic-access')).toBeVisible();
    await expect(popup.locator('#mic-access-text')).toHaveText(/doesn’t have microphone access yet/);
    await expect(popup.locator('#mic-access-action')).toHaveText('Allow microphone…');
    await expect(popup.locator('#mic-preview')).toBeHidden();
    // Sans micro, l'autorisation ne sert à rien : pas d'encart.
    await popup.locator('#mic-enabled').uncheck();
    await expect(popup.locator('#mic-access')).toBeHidden();
    await popup.locator('#mic-enabled').check();

    const ack = await send(popup, startMessage(tabId, true));
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('mic-permission');
    // Un message compréhensible, plus le « Permission dismissed » brut du navigateur.
    expect(ack.error.message).toContain('isn\'t allowed to use the microphone');

    await popup.reload();
    await expect(popup.locator('#status')).toHaveText('Microphone access needed');
    // L'encart dit déjà tout : pas d'erreur en double.
    await expect(popup.locator('#error')).toBeHidden();
    await expect(popup.locator('#mic-access')).toBeVisible();

    const [permissionPage] = await Promise.all([
      ext.context.waitForEvent('page'),
      popup.locator('#mic-access-action').click(),
    ]);
    await permissionPage.waitForLoadState();
    expect(permissionPage.url()).toBe(extensionUrl(ext.id, 'ui/mic-permission.html'));
    await expect(permissionPage.locator('#grant')).toBeVisible();
    await expect(permissionPage.locator('#settings')).toBeHidden();
  });

  test('enregistre quand même la réunion si on décoche le micro', async () => {
    const { ext, tabId } = await openMeeting(ctx());
    const popup = await openPopup(ext);
    expect(await send(popup, startMessage(tabId, false))).toEqual({ ok: true });
    const state = await send(popup, { target: 'sw', type: 'GET_STATE' });
    expect(state.status).toBe('recording');
    expect(state.mic).toBeNull();
  });
});

test.describe('micro bloqué dans les réglages de Chrome', () => {
  const ctx = useExtension('denied');

  test('mène aux réglages de Chrome, seul moyen de débloquer', async () => {
    const ext = ctx();
    const popup = await openPopup(ext);
    await expect(popup.locator('#mic-access-text')).toHaveText(/blocked/);
    await expect(popup.locator('#mic-access-action')).toHaveText('Open Chrome settings');

    await popup.locator('#mic-access-action').click();
    const site = encodeURIComponent(`chrome-extension://${ext.id}`);
    await expect
      .poll(() => ext.worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.pendingUrl ?? tab.url)))
      .toContain(`chrome://settings/content/siteDetails?site=${site}`);

    // La page d'autorisation ne propose plus une demande que Chrome n'afficherait pas.
    const page = await ext.context.newPage();
    await page.goto(extensionUrl(ext.id, 'ui/mic-permission.html'));
    await expect(page.locator('#result')).toHaveText(/blocked/);
    await expect(page.locator('#grant')).toBeHidden();
    await expect(page.locator('#settings')).toBeVisible();
  });
});

test.describe('micro autorisé après un échec', () => {
  const ctx = useExtension('granted');

  test('efface l’erreur périmée au lieu de l’afficher jusqu’au redémarrage', async () => {
    const ext = ctx();
    // État laissé par un démarrage en échec faute d'autorisation.
    await ext.worker.evaluate(() =>
      chrome.storage.session.set({
        sessionState: {
          status: 'error',
          sessionId: null,
          error: { code: 'mic-permission', message: 'OpenMeetRec isn\'t allowed to use the microphone.' },
        },
      }),
    );

    const popup = await openPopup(ext);
    await expect(popup.locator('#status')).toHaveText(/Ready to record|No target tab/);
    await expect(popup.locator('#error')).toBeHidden();
    await expect(popup.locator('#mic-access')).toBeHidden();
    expect((await send(popup, { target: 'sw', type: 'GET_STATE' })).error).toBeNull();

    const page = await ext.context.newPage();
    await page.goto(extensionUrl(ext.id, 'ui/mic-permission.html'));
    await expect(page.locator('#result')).toHaveText(/Microphone allowed/);
    await expect(page.locator('#grant')).toBeHidden();
  });
});

/** Une extension par `describe`, chacune dans son état d'autorisation. */
function useExtension(micPermission: MicPermissionSetup): () => LoadedExtension {
  let ext: LoadedExtension | undefined;
  test.beforeAll(async () => {
    ext = await launchExtension({ micPermission });
  });
  test.afterAll(async () => {
    await ext?.context.close();
  });
  return () => {
    if (!ext) throw new Error('extension not launched');
    return ext;
  };
}

async function openMeeting(ext: LoadedExtension): Promise<{ ext: LoadedExtension; tabId: number }> {
  const meeting = await ext.context.newPage();
  await meeting.goto(`${api.url}/meeting`);
  const tabId = await ext.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  });
  return { ext, tabId };
}

async function openPopup(ext: LoadedExtension): Promise<Page> {
  const popup = await ext.context.newPage();
  await popup.goto(extensionUrl(ext.id, 'ui/popup.html'));
  return popup;
}

function startMessage(tabId: number, micEnabled: boolean) {
  return { target: 'sw', type: 'START_RECORDING', tabId, url: `${api.url}/meeting`, micEnabled, micDeviceId: null };
}

async function send(popup: Page, message: unknown): Promise<any> {
  return popup.evaluate((msg) => chrome.runtime.sendMessage(msg), message);
}
