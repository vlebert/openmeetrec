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
import { clearMeetingReminder, registerMeetingReminder } from '@/background/meetingReminder';
import { absoluteIcon, IDLE_ICON, RECORDING_ICON } from '@/shared/icons';
import {
  IDLE_STATE,
  isForWorker,
  platformFromUrl,
  type Ack,
  type DownloadRequest,
  type PipelineReport,
  type SessionError,
  type SessionState,
  type ToOffscreenMessage,
  type ToWorkerMessage,
} from '@/shared/messages';
import type { SessionMeta } from '@/shared/types';

const STATE_KEY = 'sessionState';
const OFFSCREEN_PATH = 'offscreen/offscreen.html';

chrome.runtime.onInstalled.addListener(() => {
  if (detectStrategyId() === null) {
    console.warn('[openmeetrec] no capture strategy available on this browser');
  }
});

/**
 * Au réveil du service worker : si l'état dit « en cours » alors que l'offscreen
 * document a disparu, plus personne ne viendra le faire avancer. Sans ce
 * rattrapage, une session interrompue bloquerait définitivement les suivantes
 * (F-CAP-08).
 */
void (async () => {
  const state = await readState();
  if (state.status !== 'recording' && state.status !== 'processing') return;
  if (await hasOffscreen()) return;
  await writeState({
    ...state,
    status: 'error',
    error: { code: 'internal', message: 'Session interrupted by the browser' },
  });
})();

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

registerMeetingReminder({
  isSessionActive: async () => {
    const { status } = await readState();
    return status === 'recording' || status === 'processing';
  },
});

async function handle(message: ToWorkerMessage): Promise<Ack | SessionState> {
  switch (message.type) {
    case 'GET_STATE':
      return readState();
    case 'START_RECORDING':
      return startRecording(message);
    case 'STOP_RECORDING':
      return stopRecording();
    case 'RETRY_PIPELINE':
      return retryPipeline();
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
      await transcribeAndExport();
      return { ok: true };
    }
    case 'PIPELINE_PROGRESS': {
      const state = await readState();
      await writeState({ ...state, progress: { done: message.done, total: message.total } });
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
    return { ok: false, error: { code: 'already-recording', message: 'A recording is already in progress' } };
  }
  if (detectStrategyId() === null) {
    return { ok: false, error: { code: 'unsupported', message: 'Capture not supported by this browser' } };
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

  await clearMeetingReminder(message.tabId);
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

/**
 * Reprend une session en échec (F-CAP-08 côté résilience) : les chunks sont
 * déjà en OPFS, il suffit de relancer le pipeline sur le même `sessionId`.
 * Relance *tous* les chunks de la session, pas seulement ceux en échec — le
 * pipeline ne garde pas de résultats partiels d'un appel à l'autre.
 */
async function retryPipeline(): Promise<Ack> {
  const state = await readState();
  const retryable = state.status === 'error' || (state.status === 'done' && state.error !== null);
  if (!retryable || state.sessionId === null) {
    return { ok: false, error: { code: 'internal', message: 'nothing to retry' } };
  }
  await writeState({ ...state, status: 'processing', error: null, progress: null });
  await ensureOffscreen();
  await transcribeAndExport();
  return { ok: true };
}

/**
 * Enchaîne transcription (dans l'offscreen) et téléchargements (ici : seul le
 * service worker a accès à `chrome.downloads`). L'offscreen n'est fermé qu'une
 * fois les téléchargements terminés — le fermer plus tôt révoquerait les blobs
 * en cours d'écriture.
 */
async function transcribeAndExport(): Promise<void> {
  const state = await readState();
  if (state.sessionId === null) {
    await fail({ code: 'internal', message: 'unknown session' });
    return;
  }

  const config = await loadConfig();
  const meta: SessionMeta = {
    provider: config.provider,
    model: config.model,
    date: new Date().toISOString(),
    duration: state.duration,
    platform: state.platform,
    extensionVersion: chrome.runtime.getManifest().version,
  };

  let report: PipelineReport;
  try {
    report = (await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'RUN_PIPELINE',
      sessionId: state.sessionId,
      meta,
      config,
    } satisfies ToOffscreenMessage)) as PipelineReport;
  } catch (error) {
    await fail(toSessionError(error));
    return;
  }

  if (!report.ok) {
    await fail(report.error ?? { code: 'internal', message: 'transcription failed' });
    return;
  }

  const filenames: string[] = [];
  for (const download of report.downloads) {
    try {
      filenames.push(await downloadAndWait(download));
    } catch (error) {
      await fail(toSessionError(error));
      return;
    }
  }

  await closeOffscreen();
  await writeState({
    ...(await readState()),
    status: 'done',
    progress: null,
    downloads: filenames,
    chunkCount: report.transcribedCount,
    error:
      report.failedChunks.length > 0
        ? {
            code: 'internal',
            message: `${report.failedChunks.length} chunk(s) not transcribed${report.failureReason ? `: ${report.failureReason}` : ''}`,
          }
        : null,
  });
}

async function downloadAndWait(request: DownloadRequest): Promise<string> {
  const id = await chrome.downloads.download({ url: request.url, filename: request.filename, saveAs: false });
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      resolve();
    };
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== id || !delta.state) return;
      const done = delta.state.current === 'complete' || delta.state.current === 'interrupted';
      if (done) finish();
    };
    chrome.downloads.onChanged.addListener(listener);
    // Un téléchargement minuscule (ex. un markdown vide, chunks tous en échec)
    // peut déjà être terminé avant que le listener ne soit posé : sans ce
    // rattrapage, on attendrait indéfiniment un évènement déjà passé.
    void chrome.downloads.search({ id }).then(([existing]) => {
      if (existing && (existing.state === 'complete' || existing.state === 'interrupted')) finish();
    });
  });
  return request.filename;
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
  syncAction(state);
}

/**
 * Seul indicateur qui reste visible en permanence : le popup peut disparaître dès
 * qu'on change d'onglet.
 *
 * L'icône porte l'état (point rouge en cours, gris au repos) et le badge le
 * redit en toutes lettres : la couleur seule ne suffit pas, et le point rouge du
 * logo mentirait s'il restait allumé hors enregistrement.
 */
function syncAction(state: SessionState): void {
  const recording = state.status === 'recording';
  const icon = absoluteIcon(recording ? RECORDING_ICON : IDLE_ICON, (path) =>
    chrome.runtime.getURL(path),
  );
  // Pas de `void` ici : un rejet silencieux de setIcon est précisément ce qui a
  // laissé passer l'icône figée en gris pendant l'enregistrement.
  chrome.action.setIcon({ path: icon }).catch((error: unknown) => {
    console.warn('[openmeetrec] toolbar icon not updated', error);
  });
  if (recording) {
    void chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    void chrome.action.setBadgeText({ text: 'REC' });
  } else {
    void chrome.action.setBadgeText({ text: '' });
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capturing and recording the video conference audio",
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
  return response ?? { ok: false, error: { code: 'internal', message: 'offscreen document did not respond' } };
}

function toSessionError(error: unknown, code: SessionError['code'] = 'internal'): SessionError {
  return { code, message: error instanceof Error ? error.message : String(error) };
}
