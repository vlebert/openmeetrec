/**
 * Service worker MV3 — machine à états de la session (architecture §3.2).
 *
 * idle → recording → processing → done, et error depuis n'importe où.
 *
 * L'état vit dans `chrome.storage.session` et pas dans une variable de module :
 * un service worker MV3 est tué après quelques dizaines de secondes d'inactivité,
 * alors que l'enregistrement, lui, continue dans l'offscreen document. Toute
 * variable en mémoire aurait disparu à la réouverture du popup.
 */

import { detectStrategyId } from '@/capture/detect';
import { TabCaptureStrategy } from '@/capture/tabCaptureStrategy';
import { loadConfig } from '@/config/storage';
import {
  IDLE_STATE,
  isForWorker,
  platformFromUrl,
  type Ack,
  type SessionError,
  type SessionState,
  type ToOffscreenMessage,
  type ToWorkerMessage,
} from '@/shared/messages';

const STATE_KEY = 'sessionState';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';

chrome.runtime.onInstalled.addListener(() => {
  if (detectStrategyId() === null) {
    console.warn('[openmeetrec] aucune stratégie de capture disponible sur ce navigateur');
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isForWorker(message)) return false;
  handle(message).then(sendResponse, (error: unknown) => {
    sendResponse({ ok: false, error: toSessionError(error) } satisfies Ack);
  });
  return true;
});

/**
 * Filet de sécurité pour F-CAP-07. Le signal qui fait foi est la fin de la piste
 * capturée, détectée dans l'offscreen document (il voit aussi les navigations,
 * que cet événement-ci ne couvre pas).
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await readState();
    if (state.status === 'recording' && state.tabId === tabId) await stopRecording();
  })();
});

async function handle(message: ToWorkerMessage): Promise<Ack | SessionState> {
  switch (message.type) {
    case 'GET_STATE':
      return readState();
    case 'START_RECORDING':
      return startRecording(message);
    case 'STOP_RECORDING':
      return stopRecording();
    case 'RESET':
      await writeState(IDLE_STATE);
      return { ok: true };
    case 'CHUNK_READY': {
      const state = await readState();
      await writeState({ ...state, chunkCount: Math.max(state.chunkCount, message.index + 1) });
      return { ok: true };
    }
    case 'RECORDING_STOPPED': {
      const state = await readState();
      await writeState({
        ...state,
        status: 'processing',
        duration: message.duration,
        chunkCount: message.chunkCount,
      });
      await closeOffscreen();
      // TODO(F-TR-01..07) : transcription des chunks, merge et export Markdown.
      // Tant que le pipeline n'existe pas, la session s'arrête ici.
      await writeState({ ...(await readState()), status: 'done' });
      return { ok: true };
    }
    case 'CAPTURE_ERROR':
      await fail(message.error);
      return { ok: true };
  }
}

async function startRecording(
  message: Extract<ToWorkerMessage, { type: 'START_RECORDING' }>,
): Promise<Ack> {
  const state = await readState();
  // F-CAP-08 : une seule session à la fois.
  if (state.status === 'recording' || state.status === 'processing') {
    return { ok: false, error: { code: 'already-recording', message: 'Un enregistrement est déjà en cours' } };
  }
  if (detectStrategyId() === null) {
    return { ok: false, error: { code: 'unsupported', message: 'Capture non supportée par ce navigateur' } };
  }

  const sessionId = crypto.randomUUID();
  try {
    const grant = await new TabCaptureStrategy().requestGrant(message.tabId);
    const config = await loadConfig();
    await ensureOffscreen();
    const ack = await sendToOffscreen({
      target: 'offscreen',
      type: 'START_CAPTURE',
      sessionId,
      grant,
      micEnabled: message.micEnabled,
      keepFullTrack: config.downloadAudio,
    });
    if (!ack.ok) {
      await closeOffscreen();
      await writeState({ ...IDLE_STATE, error: ack.error ?? null, status: 'error' });
      return ack;
    }
  } catch (error) {
    await closeOffscreen();
    const sessionError = toSessionError(error, 'capture-failed');
    await writeState({ ...IDLE_STATE, status: 'error', error: sessionError });
    return { ok: false, error: sessionError };
  }

  await writeState({
    ...IDLE_STATE,
    status: 'recording',
    sessionId,
    tabId: message.tabId,
    platform: platformFromUrl(message.url),
    startedAt: Date.now(),
    micEnabled: message.micEnabled,
  });
  return { ok: true };
}

async function stopRecording(): Promise<Ack> {
  const state = await readState();
  if (state.status !== 'recording') return { ok: true };
  await writeState({ ...state, status: 'processing' });
  if (await hasOffscreen()) {
    await sendToOffscreen({ target: 'offscreen', type: 'STOP_CAPTURE' }).catch(() => undefined);
  } else {
    // Offscreen déjà disparu : plus rien ne viendra, on fige la session.
    await writeState({ ...(await readState()), status: 'done' });
  }
  return { ok: true };
}

async function fail(error: SessionError): Promise<void> {
  const state = await readState();
  await writeState({ ...state, status: 'error', error });
  await closeOffscreen();
}

async function readState(): Promise<SessionState> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  const state = stored[STATE_KEY] as SessionState | undefined;
  return state ? { ...IDLE_STATE, ...state } : { ...IDLE_STATE };
}

async function writeState(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capture et enregistrement de l'audio de la visioconférence",
  });
}

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

async function sendToOffscreen(message: ToOffscreenMessage): Promise<Ack> {
  const response = (await chrome.runtime.sendMessage(message)) as Ack | undefined;
  return response ?? { ok: false, error: { code: 'internal', message: 'offscreen sans réponse' } };
}

function toSessionError(error: unknown, code: SessionError['code'] = 'internal'): SessionError {
  return { code, message: error instanceof Error ? error.message : String(error) };
}
