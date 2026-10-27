/**
 * Micro débranché en cours d'enregistrement : bascule à chaud sur le micro par
 * défaut du système, sans interrompre l'enregistrement.
 *
 * Un faux micro Chromium ne se débranche pas : on émet `ended` sur la piste
 * micro de l'offscreen document, ce que fait le navigateur quand le
 * périphérique disparaît. Ce qui reste à vérifier à la main avec un vrai
 * casque : que le système désigne bien un nouveau défaut dans les délais.
 */

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { extensionUrl, launchExtension, type LoadedExtension } from './fixtures/extension';
import { startMockApi, type MockApi } from './fixtures/mockApi';

const MEETING_PAGE = fileURLToPath(new URL('./fixtures/meeting-page.html', import.meta.url));

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

test('bascule sur le micro par défaut quand le micro est débranché', async () => {
  const meeting = await ext.context.newPage();
  await meeting.goto(`${api.url}/meeting`);
  const tabId = await ext.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  });

  const popup = await ext.context.newPage();
  await popup.goto(extensionUrl(ext.id, 'ui/popup.html'));
  const started = await send(popup, {
    target: 'sw',
    type: 'START_RECORDING',
    tabId,
    url: `${api.url}/meeting`,
    micEnabled: true,
    micDeviceId: null,
  });
  expect(started).toEqual({ ok: true });
  await popup.waitForTimeout(1000);

  expect(await unplugMic(popup)).toBe(1);

  await expect
    .poll(async () => (await send(popup, { target: 'sw', type: 'GET_STATE' })).mic)
    .toMatchObject({ switched: true, lost: false });
  const state = await send(popup, { target: 'sw', type: 'GET_STATE' });
  expect(state.status).toBe('recording');
  expect(state.mic.name).not.toBe('');

  // Le nouveau micro arrive bien dans le mixer (le faux micro émet un bip).
  await expect
    .poll(async () => (await send(popup, { target: 'offscreen', type: 'GET_LEVELS' })).mic)
    .toBeGreaterThan(0);

  await popup.reload();
  await expect(popup.locator('#mic-warning')).toHaveText('Microphone disconnected — switched to the system default.');

  await send(popup, { target: 'sw', type: 'STOP_RECORDING' });
});

/**
 * Émet `ended` sur la piste micro de l'offscreen document, reconnue à ses
 * contraintes explicites (la fausse capture d'onglet n'en a aucune).
 * L'offscreen n'est pas une `Page` Playwright : on passe par CDP.
 */
async function unplugMic(popup: Page): Promise<number> {
  const cdp = await ext.context.newCDPSession(popup);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const offscreen = targetInfos.find((target) => target.url.endsWith('offscreen/offscreen.html'));
  if (!offscreen) throw new Error('offscreen document not found');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: offscreen.targetId, flatten: false });
  const call = targetCaller(cdp, sessionId);

  const proto = await call('Runtime.evaluate', { expression: 'MediaStreamTrack.prototype' });
  const tracks = await call('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const dispatched = await call('Runtime.callFunctionOn', {
    objectId: tracks.objects.objectId,
    returnByValue: true,
    functionDeclaration: `function () {
      const mics = this.filter((t) => t.readyState === 'live' && t.getConstraints().noiseSuppression === true);
      for (const t of mics) t.dispatchEvent(new Event('ended'));
      return mics.length;
    }`,
  });
  await cdp.detach();
  return dispatched.result.value as number;
}

/** Commandes CDP vers une cible attachée sans `flatten` (seul mode qu'expose Playwright). */
function targetCaller(cdp: CDPSession, sessionId: string): (method: string, params: object) => Promise<any> {
  let nextId = 0;
  return (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const listener = (event: { message: string }) => {
        const reply = JSON.parse(event.message) as { id?: number; result?: unknown; error?: { message: string } };
        if (reply.id !== id) return;
        cdp.off('Target.receivedMessageFromTarget', listener);
        if (reply.error) reject(new Error(reply.error.message));
        else resolve(reply.result);
      };
      cdp.on('Target.receivedMessageFromTarget', listener);
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
    });
}

async function send(popup: Page, message: unknown): Promise<any> {
  return popup.evaluate((msg) => chrome.runtime.sendMessage(msg), message);
}
