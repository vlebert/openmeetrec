/**
 * Service worker MV3 — machine à états de la session (architecture §3.2).
 *
 * idle → recording → processing → done, et error depuis n'importe où.
 *
 * L'état vit dans `chrome.storage.local` et pas dans une variable de module :
 * un service worker MV3 est tué après quelques dizaines de secondes d'inactivité,
 * alors que l'enregistrement, lui, continue dans l'offscreen document. Toute
 * variable en mémoire aurait disparu à la réouverture du popup. `storage.local`
 * (et pas `storage.session`) pour que l'état survive aussi à un redémarrage du
 * navigateur : les chunks audio restent en OPFS dans ce cas, et la session peut
 * être retraitée au lieu d'être orphelinée puis effacée au prochain start.
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
  type AudioDownloadAck,
  type CaptureAck,
  type DownloadRequest,
  type OffscreenStatus,
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
 *
 * Appelé à chaque évaluation du module (réveil MV3) **et** explicitement au
 * démarrage du navigateur (`onStartup`) : avec l'état persisté dans
 * `storage.local`, un état `recording`/`processing` survit à un redémarrage du
 * navigateur alors que l'offscreen n'existe plus — sans `onStartup`, la
 * normalisation n'aurait lieu que au premier évènement qui réveille le SW.
 * L'état passe à `error`, ce qui rend la session retraitable depuis le popup
 * (les chunks sont toujours en OPFS).
 */
async function recoverOrphanedSession(): Promise<void> {
  const state = await readState();
  if (state.status !== 'recording' && state.status !== 'processing') return;
  if (await hasOffscreen()) return;
  await writeState({
    ...state,
    status: 'error',
    error: {
      code: 'internal',
      message: 'Previous session was interrupted; the saved audio chunks can still be transcribed',
    },
  });
}

void recoverOrphanedSession();
chrome.runtime.onStartup.addListener(() => void recoverOrphanedSession());

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
    case 'MIC_SWITCHED': {
      const state = await readState();
      if (state.status === 'recording' && state.mic) {
        await writeState({ ...state, mic: { ...state.mic, name: message.name, switched: true, lost: false } });
      }
      return { ok: true };
    }
    case 'MIC_LOST': {
      // L'enregistrement continue avec le son de l'onglet seul : on prévient
      // plutôt que d'interrompre une réunion en cours.
      const state = await readState();
      if (state.status === 'recording' && state.mic) await writeState({ ...state, mic: { ...state.mic, lost: true } });
      return { ok: true };
    }
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
  let ack: CaptureAck;
  try {
    const grant = await new TabCaptureStrategy().requestGrant(message.tabId);
    const config = await loadConfig();
    await ensureOffscreen();
    ack = await sendToOffscreen({
      target: 'offscreen',
      type: 'START_CAPTURE',
      sessionId,
      grant,
      micEnabled: message.micEnabled,
      micDeviceId: message.micDeviceId,
      // Toujours vrai : la piste continue est ce qui rend possible la
      // transcription en une seule requête, donc des identités de speakers
      // cohérentes. On ne peut pas la reconstituer après coup à partir des
      // chunks (conteneurs webm autonomes et recouvrants), ni l'inverse sans
      // réencoder — les deux enregistrements doivent donc tourner ensemble.
      // `config.downloadAudio` ne gouverne plus que la sortie du fichier audio.
      keepFullTrack: true,
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
    mic: ack.mic ? { ...ack.mic, switched: false, lost: false } : null,
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
 * Reprend une session en échec, retraite une session déjà terminée avec succès
 * (relancer avec un autre provider/modèle, ou après un correctif du pipeline),
 * ou **relance une session encore en `processing`** — le cas « finishing coincé » :
 * fermer l'offscreen document annule ses requêtes en vol, et les chunks restent
 * en OPFS (`pruneSessions` n'efface qu'au prochain `START_RECORDING`), il suffit
 * de relancer le pipeline sur le même `sessionId`. Relance *tous* les chunks de
 * la session, pas seulement ceux en échec — le pipeline ne garde pas de
 * résultats partiels d'un appel à l'autre.
 */
async function retryPipeline(): Promise<Ack> {
  const state = await readState();
  const retryable = state.status === 'error' || state.status === 'done' || state.status === 'processing';
  if (!retryable || state.sessionId === null) {
    return { ok: false, error: { code: 'internal', message: 'nothing to retry' } };
  }
  // Invalide tout run en vol *avant* de toucher à l'offscreen : son `fail()`
  // éventuel ne devra plus rien écrire.
  pipelineEpoch += 1;
  if (state.status === 'processing' && (pipelineRunning || (await offscreenPipelineRunning()))) {
    // Un pipeline tourne (ou est en file) dans l'offscreen et peut être bloqué
    // sur une requête qui ne répond plus : fermer le document tue ses fetch.
    // `offscreenPipelineRunning()` couvre le cas où ce SW a été redémarré entre-
    // temps (`pipelineRunning` est alors remis à zéro bien que l'offscreen
    // tourne encore). Si aucun pipeline n'est en vol (fenêtre Stop →
    // RECORDING_STOPPED), on ne touche PAS à l'offscreen : il peut être en plein
    // `finish()` et le fermer tronquerait la piste audio en cours d'écriture.
    await closeOffscreen();
  }
  await writeState({ ...state, status: 'processing', error: null, progress: null });
  await ensureOffscreen();
  await transcribeAndExport();
  return { ok: true };
}

/**
 * Compteur de runs du pipeline. Un `RETRY_PIPELINE` pendant un `processing`
 * ferme l'offscreen, ce qui fait échouer le run en vol : celui-ci ne doit alors
 * ni écrire `error` ni fermer l'offscreen ni écraser l'état du run relancé.
 */
let pipelineEpoch = 0;
/** Vrai tant qu'un run de `transcribeAndExport` est en vol dans cette instance de SW. */
let pipelineRunning = false;
/**
 * Téléchargement audio du run courant. Conservé au niveau du module pour que
 * `fail()` puisse l'attendre avant de fermer l'offscreen (fermer le document
 * révoquerait le blob et interromperait le `.webm` en cours).
 */
let activeAudioDownload: Promise<{ request: DownloadRequest; name: string | null } | null> | null = null;

/** Demande à l'offscreen s'il exécute (ou a en file) un pipeline. */
async function offscreenPipelineRunning(): Promise<boolean> {
  if (!(await hasOffscreen())) return false;
  try {
    const status = (await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PIPELINE_STATUS',
    } satisfies ToOffscreenMessage)) as OffscreenStatus | undefined;
    return status?.running ?? false;
  } catch {
    return false;
  }
}

/**
 * Enchaîne transcription (dans l'offscreen) et téléchargements (ici : seul le
 * service worker a accès à `chrome.downloads`). L'offscreen n'est fermé qu'une
 * fois les téléchargements terminés — le fermer plus tôt révoquerait les blobs
 * en cours d'écriture.
 *
 * Si l'export audio est demandé, son téléchargement part **dès l'entrée en
 * processing** (la piste est finalisée au Stop), en parallèle de la
 * transcription : l'utilisateur récupère son `.webm` tout de suite, sans
 * attendre la fin du speech-to-text.
 */
async function transcribeAndExport(): Promise<void> {
  const epoch = ++pipelineEpoch;
  const stale = (): boolean => epoch !== pipelineEpoch;
  pipelineRunning = true;
  try {
    const state = await readState();
    if (state.sessionId === null) {
      await fail({ code: 'internal', message: 'unknown session' }, epoch);
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

    // Déjà téléchargé (run précédent) : on ne le renvoie pas à chaque retry.
    const alreadyHasAudio = state.downloads.some((name) => name.endsWith('.webm'));
    const audioDownload: Promise<{ request: DownloadRequest; name: string | null } | null> = (
      config.downloadAudio && !alreadyHasAudio
        ? prepareAudioDownload(state.sessionId, meta).then(async (ack) => {
            if (!ack.ok || !ack.download) return null;
            const name = await downloadAndWait(ack.download);
            return { request: ack.download, name };
          })
        : Promise.resolve(null)
    )
      .then(async (audio) => {
        // Dès que le .webm est téléchargé, son nom est enregistré dans l'état :
        // un échec du pipeline ou un retry ne doit ni faire perdre le fichier,
        // ni le retélécharger en double (« audio (1).webm »…).
        if (audio?.name) {
          try {
            const s = await readState();
            await writeState({ ...s, downloads: [...new Set([...s.downloads, audio.name])] });
          } catch {
            // État illisible : l'écriture finale du run reprendra le nom.
          }
        }
        return audio;
      })
      .catch(() => null);
    activeAudioDownload = audioDownload;

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
      await fail(toSessionError(error), epoch);
      return;
    }

    if (!report.ok) {
      await fail(report.error ?? { code: 'internal', message: 'transcription failed' }, epoch);
      return;
    }

    const filenames: string[] = [];
    for (const download of report.downloads) {
      try {
        const name = await downloadAndWait(download);
        if (name === null) throw new Error(`download interrupted: ${download.filename}`);
        filenames.push(name);
        revokeBlob(download.url);
      } catch (error) {
        await fail(toSessionError(error), epoch);
        return;
      }
    }

    // Stale : un retry a tué notre offscreen et en a recréé un autre — ne pas
    // attendre le téléchargement audio, ne pas fermer l'offscreen, ne pas écrire.
    if (stale()) return;
    const audio = await audioDownload;
    if (audio) revokeBlob(audio.request.url);
    const audioFilename = audio?.name ?? null;
    if (stale()) return;
    await closeOffscreen();
    if (stale()) return;

    const fresh = await readState();
    if (stale()) return;

    const notes: string[] = [];
    if (report.failedChunks.length > 0) {
      notes.push(
        `${report.failedChunks.length} chunk(s) not transcribed${report.failureReason ? `: ${report.failureReason}` : ''}`,
      );
    }
    if (config.downloadAudio && !alreadyHasAudio && !audioFilename) {
      notes.push('audio file could not be exported');
    }
    await writeState({
      ...fresh,
      status: 'done',
      progress: null,
      // Fusion, pas écrasement : un retry après succès conserve le .webm déjà
      // téléchargé (et ne le retélécharge pas).
      downloads: [...new Set([...fresh.downloads, ...(audioFilename ? [audioFilename] : []), ...filenames])],
      chunkCount: report.transcribedCount,
      error: notes.length > 0 ? { code: 'internal', message: notes.join('; ') } : null,
    });
  } finally {
    // Un run périmé (remplacé par un retry) ne doit pas remettre à zéro les
    // drapeaux du run courant.
    if (epoch === pipelineEpoch) {
      pipelineRunning = false;
      activeAudioDownload = null;
    }
  }
}

/** Demande à l'offscreen le blob de la piste complète, prête à télécharger. */
async function prepareAudioDownload(sessionId: string, meta: SessionMeta): Promise<AudioDownloadAck> {
  try {
    return (await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PREPARE_AUDIO_DOWNLOAD',
      sessionId,
      meta,
    } satisfies ToOffscreenMessage)) as AudioDownloadAck;
  } catch (error) {
    return { ok: false, error: toSessionError(error) };
  }
}

/**
 * Attend la fin d'un téléchargement et renvoie le nom de fichier, ou `null` si
 * le téléchargement a été interrompu (blob révoqué, disque plein…) : un
 * `interrupted` n'est pas un succès, et ne doit pas empêcher un retry.
 */
async function downloadAndWait(request: DownloadRequest): Promise<string | null> {
  const id = await chrome.downloads.download({ url: request.url, filename: request.filename, saveAs: false });
  const finalState = await new Promise<'complete' | 'interrupted'>((resolve) => {
    let settled = false;
    const finish = (state: 'complete' | 'interrupted'): void => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      resolve(state);
    };
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== id || !delta.state) return;
      const current = delta.state.current;
      if (current === 'complete' || current === 'interrupted') finish(current);
    };
    chrome.downloads.onChanged.addListener(listener);
    // Un téléchargement minuscule (ex. un markdown vide, chunks tous en échec)
    // peut déjà être terminé avant que le listener ne soit posé : sans ce
    // rattrapage, on attendrait indéfiniment un évènement déjà passé.
    void chrome.downloads.search({ id }).then(([existing]) => {
      const current = existing?.state;
      if (current === 'complete' || current === 'interrupted') finish(current);
    });
  });
  return finalState === 'complete' ? request.filename : null;
}

/**
 * Révoque l'URL blob une fois le téléchargement consommé (même origine, donc
 * possible depuis le service worker). Sinon le blob de la piste complète resterait
 * valide dans le magasin de blobs jusqu'à la fermeture de l'offscreen.
 */
function revokeBlob(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // `revokeObjectURL` indisponible ici : le blob meurt de toute façon avec l'offscreen.
  }
}

/**
 * Passe la session en `error`. Avec un `epoch`, n'écrit rien si ce run a été
 * rendu stale par un retry entre-temps — vérifié après chaque `await`, pour ne
 * pas écraser l'état du run relancé ni fermer son offscreen.
 *
 * Attend d'abord le téléchargement audio en cours : fermer l'offscreen
 * révoquerait le blob et interromperait le `.webm` ; son nom est enregistré
 * dans l'état pour qu'un retry ne le retélécharge pas.
 */
async function fail(error: SessionError, epoch?: number): Promise<void> {
  const current = (): boolean => epoch === undefined || epoch === pipelineEpoch;
  if (!current()) return;
  const state = await readState();
  const audio = activeAudioDownload ? await activeAudioDownload.catch(() => null) : null;
  if (!current()) return;
  await writeState({
    ...state,
    status: 'error',
    error,
    downloads: audio?.name ? [...new Set([...state.downloads, audio.name])] : state.downloads,
  });
  if (!current()) return;
  await closeOffscreen();
}

async function readState(): Promise<SessionState> {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] as SessionState | undefined;
  return state ? { ...IDLE_STATE, ...state } : { ...IDLE_STATE };
}

async function writeState(state: SessionState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
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

async function sendToOffscreen(message: ToOffscreenMessage): Promise<CaptureAck> {
  const response = (await chrome.runtime.sendMessage(message)) as CaptureAck | undefined;
  return response ?? { ok: false, error: { code: 'internal', message: 'offscreen document did not respond' } };
}

function toSessionError(error: unknown, code: SessionError['code'] = 'internal'): SessionError {
  return { code, message: error instanceof Error ? error.message : String(error) };
}
