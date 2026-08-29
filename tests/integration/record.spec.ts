/**
 * Session complète : capture → chunks → transcription → merge → markdown.
 *
 * C'est le seul test qui exerce la chaîne réelle dans un navigateur réel. Tout
 * ce qu'il couvre était, sinon, du code jamais exécuté.
 *
 * Non couvert, et ça ne peut pas l'être : le grant `activeTab` et donc le vrai
 * `chrome.tabCapture` (architecture §10.3), ainsi que le fait que le son de
 * l'onglet reste audible pour un humain (F-CAP-06).
 */

import { expect, test, type Page, type Worker } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { extensionUrl, launchExtension, type LoadedExtension } from './fixtures/extension';
import { startMockApi, type MockApi } from './fixtures/mockApi';

const MEETING_PAGE = fileURLToPath(new URL('./fixtures/meeting-page.html', import.meta.url));

/** 50 s : assez pour quatre chunks de 20 s décalés de 15 s dans le build de test. */
const RECORDING_MS = 50_000;
const EXPECTED_CHUNKS = 4;

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

test('enregistre une réunion, la transcrit et exporte un markdown', async () => {
  const meeting = await ext.context.newPage();
  await meeting.goto(`${api.url}/meeting`);
  await expect(meeting.locator('#state')).toHaveText('flux distant reçu');

  // Avant d'ouvrir le popup : c'est encore l'onglet de visio qui est actif.
  const tabId = await ext.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  });
  expect(tabId).toBeGreaterThan(0);

  await configure(ext.worker, `${api.url}/v1/audio/transcriptions`);

  const popup = await ext.context.newPage();
  await popup.goto(extensionUrl(ext.id, 'ui/popup.html'));

  const started = await send(popup, {
    target: 'sw',
    type: 'START_RECORDING',
    tabId,
    url: `${api.url}/meeting`,
    micEnabled: true,
  });
  expect(started).toEqual({ ok: true });

  await popup.waitForTimeout(RECORDING_MS);

  const recording = await send(popup, { target: 'sw', type: 'GET_STATE' });
  expect(recording.status).toBe('recording');
  // Les chunks sont écrits pendant l'enregistrement, pas à la fin (F-AUD-03).
  // Borne à 2 et non 3 : le troisième chunk se termine pile à t = 50 s, l'exiger
  // ici rendrait le test dépendant de quelques millisecondes.
  expect(recording.chunkCount).toBeGreaterThanOrEqual(2);

  // Indicateur visible quel que soit l'onglet actif : le popup, lui, disparaît
  // dès qu'on clique ailleurs.
  const badge = await ext.worker.evaluate(() => chrome.action.getBadgeText({}));
  expect(badge).toBe('REC');

  await send(popup, { target: 'sw', type: 'STOP_RECORDING' });
  const final = await waitForDone(popup);

  expect(final.status).toBe('done');
  const badgeAfter = await ext.worker.evaluate(() => chrome.action.getBadgeText({}));
  expect(badgeAfter).toBe('');
  expect(final.error).toBeNull();
  expect(final.chunkCount).toBe(EXPECTED_CHUNKS);
  expect(final.downloads).toHaveLength(1);

  // Ce que l'extension a réellement envoyé sur le réseau.
  expect(api.calls).toHaveLength(EXPECTED_CHUNKS);
  for (const call of api.calls) {
    expect(call.authorization).toBe('Bearer cle-de-test');
    expect(call.fields).toContain('file');
    expect(call.fields).toContain('model');
    // Segments demandés systématiquement, même sans diarization (F-TR-04).
    expect(call.fields).toContain('timestamp_granularities[]');
  }
  // Le dernier chunk est plus court : il s'arrête avec l'enregistrement.
  const sizes = api.calls.map((c) => c.bytes).sort((a, b) => a - b);
  expect(sizes[0]).toBeLessThan(sizes[sizes.length - 1]! / 2);

  const markdown = await readDownload(ext.worker);
  expect(markdown).toContain('provider: custom');
  expect(markdown).toContain('platform: localhost');
  expect(markdown).toContain('speakers: 2');
  expect(markdown).not.toContain('Transcription failed');
  // Une section par chunk transcrit, pour rendre lisible le fait que la
  // numérotation des speakers repart de zéro à chaque frontière. Le nombre de
  // sections dépend de la distribution des segments près de la fin de la
  // session (chunk final potentiellement très court) : on vérifie qu'il y en a
  // plusieurs, pas un compte exact.
  const chunkSections = [...markdown.matchAll(/\*\*Chunk \d+\*\*/g)];
  expect(chunkSections.length).toBeGreaterThanOrEqual(2);
  expect(markdown).toContain('**Chunk 1**');

  // Le merge doit rendre une grille continue, sans doublon aux frontières de
  // chunks : c'est tout l'intérêt de la coupe au milieu de l'overlap (F-AUD-06).
  const stamps = [...markdown.matchAll(/\((\d\d):(\d\d):(\d\d)\)/g)].map(
    ([, h, m, s]) => Number(h) * 3600 + Number(m) * 60 + Number(s),
  );
  expect(stamps.length).toBeGreaterThanOrEqual(9);
  expect(new Set(stamps).size).toBe(stamps.length);
  expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  expect(stamps[0]).toBe(0);
  for (let i = 1; i < stamps.length; i += 1) {
    expect(stamps[i]! - stamps[i - 1]!).toBe(5);
  }
});

test('reprend la transcription après un échec API, sans perdre les chunks (retry)', async () => {
  // `api.calls` est partagé sur tout le fichier (un seul serveur pour tous les
  // tests) : chaque assertion se limite aux appels émis depuis cette borne.
  const callsBeforeSession = api.calls.length;
  api.setFailing(500);

  const meeting = await ext.context.newPage();
  await meeting.goto(`${api.url}/meeting`);
  await expect(meeting.locator('#state')).toHaveText('flux distant reçu');

  const tabId = await ext.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  });
  expect(tabId).toBeGreaterThan(0);

  await configure(ext.worker, `${api.url}/v1/audio/transcriptions`);

  const popup = await ext.context.newPage();
  await popup.goto(extensionUrl(ext.id, 'ui/popup.html'));

  const started = await send(popup, {
    target: 'sw',
    type: 'START_RECORDING',
    tabId,
    url: `${api.url}/meeting`,
    micEnabled: true,
  });
  expect(started).toEqual({ ok: true });

  await popup.waitForTimeout(RECORDING_MS);
  await send(popup, { target: 'sw', type: 'STOP_RECORDING' });

  // 500 est réessayable (retry.ts) : chaque chunk épuise ses tentatives avant
  // que le pipeline ne rende la main — d'où l'API qui répond en échec, mais
  // pas de statut `error` (F-pipeline : un chunk raté ne casse pas la session).
  const failed = await waitForDone(popup);
  expect(failed.status).toBe('done');
  expect(failed.error?.message).toContain(`${EXPECTED_CHUNKS} chunk`);
  const failedCalls = api.calls.slice(callsBeforeSession);
  expect(failedCalls.length).toBeGreaterThan(0);
  expect(failedCalls.every((call) => call.status === 500)).toBe(true);

  const callsBeforeRetry = api.calls.length;
  api.setFailing(null);

  const retried = await send(popup, { target: 'sw', type: 'RETRY_PIPELINE' });
  expect(retried).toEqual({ ok: true });

  const recovered = await waitForDone(popup);
  expect(recovered.status).toBe('done');
  expect(recovered.error).toBeNull();
  expect(recovered.chunkCount).toBe(EXPECTED_CHUNKS);

  // Le retry relance toute la session (pas de résultats partiels persistés) :
  // les EXPECTED_CHUNKS chunks repartent, cette fois avec succès.
  const retryCalls = api.calls.slice(callsBeforeRetry);
  expect(retryCalls).toHaveLength(EXPECTED_CHUNKS);
  expect(retryCalls.every((call) => call.status === 200)).toBe(true);

  const markdown = await readLatestDownload(ext.worker);
  expect(markdown).not.toContain('not transcribed');
  expect(markdown).toContain('segment 0');

  await meeting.close();
  await popup.close();
});

async function configure(worker: Worker, endpoint: string): Promise<void> {
  await worker.evaluate(async (url) => {
    await chrome.storage.local.set({
      config: {
        provider: 'custom',
        model: 'mock-1',
        customEndpoint: url,
        customSupportsSegments: true,
        customSupportsDiarization: true,
        apiKeys: { custom: 'cle-de-test' },
        diarize: true,
        downloadAudio: false,
        language: null,
      },
    });
  }, endpoint);
}

// Le popup est un contexte d'extension : c'est de là que part le messaging,
// comme lors d'un usage réel.
async function send(popup: Page, message: unknown): Promise<any> {
  return popup.evaluate((msg) => chrome.runtime.sendMessage(msg), message);
}

async function waitForDone(popup: Page): Promise<any> {
  for (let i = 0; i < 60; i += 1) {
    await popup.waitForTimeout(1000);
    const state = await send(popup, { target: 'sw', type: 'GET_STATE' });
    if (state.status === 'done' || state.status === 'error') return state;
  }
  throw new Error('la session ne se termine pas');
}

async function readDownload(worker: Worker): Promise<string> {
  const files = await worker.evaluate(() => chrome.downloads.search({}));
  const done = files.filter((f) => f.state === 'complete' && f.filename);
  expect(done).toHaveLength(1);
  return readFile(done[0]!.filename, 'utf8');
}

/** Le plus récent téléchargement complet — pour les tests qui en déclenchent plusieurs. */
async function readLatestDownload(worker: Worker): Promise<string> {
  const files = await worker.evaluate(() => chrome.downloads.search({}));
  const done = files.filter((f) => f.state === 'complete' && f.filename).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  expect(done.length).toBeGreaterThan(0);
  return readFile(done[0]!.filename!, 'utf8');
}
