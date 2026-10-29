/**
 * UI — popup, surface de contrôle principale (PRD §3).
 *
 * Le popup est ouvert *depuis* l'onglet de visio : l'onglet actif est donc la
 * cible de capture, sans ambiguïté, et son ouverture fournit le grant
 * `activeTab` nécessaire à `tabCapture`.
 */

import { micConstraints, micOptions, resolveMicChoice, type MicChoice } from '@/audio/micDevices';
import { createLevelMeter, type LevelMeter } from '@/audio/mix';
import { loadMicDevice, saveMicDevice } from '@/config/storage';
import { formatTimestamp } from '@/shared/format';
import type { Ack, AudioLevels, SessionState, ToOffscreenMessage, ToWorkerMessage } from '@/shared/messages';

const LEVELS_INTERVAL_MS = 150;

const el = {
  status: byId<HTMLParagraphElement>('status'),
  timer: byId<HTMLParagraphElement>('timer'),
  meters: byId<HTMLElement>('meters'),
  micLevel: byId<HTMLSpanElement>('mic-level'),
  tabLevel: byId<HTMLSpanElement>('tab-level'),
  micName: byId<HTMLParagraphElement>('mic-name'),
  micWarning: byId<HTMLParagraphElement>('mic-warning'),
  micOption: byId<HTMLElement>('mic-option'),
  micEnabled: byId<HTMLInputElement>('mic-enabled'),
  micDevice: byId<HTMLSelectElement>('mic-device'),
  micMissing: byId<HTMLParagraphElement>('mic-missing'),
  micPreview: byId<HTMLLabelElement>('mic-preview'),
  micPreviewLevel: byId<HTMLSpanElement>('mic-preview-level'),
  toggle: byId<HTMLButtonElement>('toggle'),
  error: byId<HTMLParagraphElement>('error'),
  history: byId<HTMLParagraphElement>('history'),
  retry: byId<HTMLButtonElement>('retry'),
  grantMic: byId<HTMLButtonElement>('grant-mic'),
  platform: byId<HTMLElement>('platform'),
  options: byId<HTMLAnchorElement>('options'),
};

let tabId: number | null = null;
let tabUrl = '';
let state: SessionState | null = null;
/** Micro mémorisé, `null` = défaut système. */
let preferredMic: string | null = null;
/** Micro qui sera réellement ouvert : le mémorisé s'il est branché, sinon le défaut. */
let resolvedMic: MicChoice = null;

/**
 * Aperçu du niveau du micro sélectionné, avant d'enregistrer : un nom de
 * périphérique ne dit pas toujours quel est le bon micro, une barre qui bouge
 * quand on parle, si.
 */
let preview: { stream: MediaStream; meter: LevelMeter } | null = null;
/**
 * Micro dont l'aperçu est demandé (`''` = défaut système, `null` = aucun), pour
 * ignorer une ouverture rendue obsolète entre-temps.
 */
let previewWanted: string | null = null;
/** Démarrage en cours : l'aperçu doit rester fermé, l'offscreen ouvre le micro. */
let starting = false;

el.toggle.addEventListener('click', () => void onToggle());
el.grantMic.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('ui/mic-permission.html') });
});
el.retry.addEventListener('click', () => void onRetry());
el.micEnabled.addEventListener('change', () => {
  el.micDevice.disabled = !el.micEnabled.checked;
  void syncPreview();
});
el.micDevice.addEventListener('change', () => {
  preferredMic = el.micDevice.value === '' ? null : el.micDevice.value;
  resolvedMic = preferredMic;
  el.micMissing.hidden = true;
  void saveMicDevice(preferredMic);
  void syncPreview();
});
// Le navigateur libère le micro à la fermeture du popup ; on le fait quand même
// explicitement, l'indicateur « micro utilisé » doit s'éteindre aussitôt.
window.addEventListener('pagehide', () => void stopPreview());
// Casque branché ou débranché pendant que le popup est ouvert.
navigator.mediaDevices.addEventListener('devicechange', () => void loadMics());
el.options.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

void init();

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  tabUrl = tab?.url ?? '';
  el.platform.textContent = hostOf(tabUrl);
  preferredMic = await loadMicDevice();
  await loadMics();
  await refresh();
  setInterval(() => void refresh(), LEVELS_INTERVAL_MS * 4);
  setInterval(() => void refreshLevels(), LEVELS_INTERVAL_MS);
  setInterval(() => {
    if (preview) el.micPreviewLevel.style.width = `${Math.round(preview.meter.level() * 100)}%`;
  }, LEVELS_INTERVAL_MS);
}

async function onToggle(): Promise<void> {
  el.toggle.disabled = true;
  const recording = state?.status === 'recording';
  // Libère le micro avant que l'offscreen ne l'ouvre : certains périphériques
  // (USB sous Windows notamment) n'acceptent qu'un client à la fois.
  if (!recording) {
    starting = true;
    await syncPreview();
  }
  const message: ToWorkerMessage = recording
    ? { target: 'sw', type: 'STOP_RECORDING' }
    : {
        target: 'sw',
        type: 'START_RECORDING',
        tabId: tabId ?? -1,
        url: tabUrl,
        micEnabled: el.micEnabled.checked,
        // Le micro mémorisé, même s'il semble absent : l'offscreen se replie
        // sur le défaut système et le signale.
        micDeviceId: preferredMic,
      };
  try {
    const ack = (await chrome.runtime.sendMessage(message)) as Ack;
    if (!ack.ok && ack.error) showError(ack.error.message, ack.error.code === 'mic-permission');
  } finally {
    starting = false;
  }
  // Rouvre l'aperçu si le démarrage a échoué.
  await refresh();
}

/**
 * Remplit le sélecteur. Les noms des micros ne sont visibles qu'une fois
 * l'autorisation micro accordée à l'extension (`ui/mic-permission.html`).
 */
async function loadMics(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const { choice, missing } = resolveMicChoice(preferredMic, devices);
  el.micDevice.replaceChildren(
    ...micOptions(devices).map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  el.micDevice.value = choice ?? '';
  el.micMissing.hidden = !missing;
  resolvedMic = choice;
  await syncPreview();
}

/**
 * Ouvre, change ou ferme l'aperçu selon l'état du popup. Appelée à chaque
 * rendu : ne fait rien si le bon micro est déjà ouvert.
 */
async function syncPreview(): Promise<void> {
  const idle = state !== null && state.status !== 'recording' && state.status !== 'processing';
  const wanted = idle && !starting && el.micEnabled.checked ? (resolvedMic ?? '') : null;
  if (wanted === previewWanted) return;
  previewWanted = wanted;
  await stopPreview();
  // Le popup ne peut pas afficher de demande d'autorisation : sans autorisation
  // déjà accordée, pas d'aperçu (le bouton « Allow microphone… » s'en charge).
  if (wanted === null || !(await micGranted())) return;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(wanted === '' ? null : wanted));
  } catch {
    return;
  }
  if (previewWanted !== wanted) {
    // Autre micro choisi (ou enregistrement lancé) pendant l'ouverture.
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  preview = { stream, meter: createLevelMeter(stream) };
  el.micPreview.hidden = false;
}

async function stopPreview(): Promise<void> {
  const current = preview;
  preview = null;
  el.micPreview.hidden = true;
  el.micPreviewLevel.style.width = '0%';
  if (!current) return;
  current.stream.getTracks().forEach((track) => track.stop());
  await current.meter.close();
}

async function micGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

async function onRetry(): Promise<void> {
  el.retry.disabled = true;
  await chrome.runtime.sendMessage({ target: 'sw', type: 'RETRY_PIPELINE' } satisfies ToWorkerMessage);
  el.retry.disabled = false;
  await refresh();
}

async function refresh(): Promise<void> {
  state = (await chrome.runtime.sendMessage({ target: 'sw', type: 'GET_STATE' } satisfies ToWorkerMessage)) as SessionState;
  render();
}

async function refreshLevels(): Promise<void> {
  if (state?.status !== 'recording') return;
  try {
    const levels = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_LEVELS' } satisfies ToOffscreenMessage)) as AudioLevels | undefined;
    if (!levels) return;
    el.micLevel.style.width = `${Math.round(levels.mic * 100)}%`;
    el.tabLevel.style.width = `${Math.round(levels.tab * 100)}%`;
  } catch {
    // Offscreen absent : rien à afficher.
  }
  if (state.startedAt !== null) {
    el.timer.textContent = formatTimestamp((Date.now() - state.startedAt) / 1000);
  }
}

function render(): void {
  const current = state;
  if (!current) return;
  const recording = current.status === 'recording';
  const busy = current.status === 'processing';

  el.toggle.textContent = recording ? 'Stop' : 'Start';
  el.toggle.disabled = busy || (!recording && tabId === null);
  el.status.textContent = statusLabel(current);
  el.timer.hidden = !recording;
  el.meters.hidden = !recording;
  el.micOption.hidden = recording || busy;
  el.micEnabled.disabled = recording || busy;
  el.micDevice.disabled = recording || busy || !el.micEnabled.checked;
  renderMic(recording ? current : null);
  void syncPreview();

  if (current.error) {
    showError(current.error.message, current.error.code === 'mic-permission');
  } else {
    hideError();
  }

  const canRetry = current.sessionId !== null && (current.status === 'error' || current.status === 'done');
  el.retry.hidden = !canRetry;
  // Le petit texte « transcription précédente disponible » ne sert qu'au cas
  // nominal (succès sans erreur) : l'erreur elle-même l'explique déjà sinon.
  el.history.hidden = !(canRetry && current.status === 'done' && current.error === null);

  if (recording && current.startedAt !== null) {
    el.timer.textContent = formatTimestamp((Date.now() - current.startedAt) / 1000);
    if (current.platform) el.platform.textContent = current.platform;
  }
}

/** Micro réellement enregistré, à côté des meters. */
function renderMic(current: SessionState | null): void {
  const mic = current?.mic ?? null;
  el.micName.hidden = mic === null;
  el.micName.textContent = mic ? `Mic: ${mic.name}` : '';
  el.micName.title = el.micName.textContent;
  const warning = !current
    ? ''
    : !current.micEnabled
      ? 'Microphone not recorded.'
      : mic?.lost
        ? 'Microphone disconnected — only the meeting audio is being recorded.'
        : mic?.switched
          ? 'Microphone disconnected — switched to the system default.'
          : mic?.fallback
            ? 'Saved microphone not found — recording the system default.'
            : '';
  el.micWarning.hidden = warning === '';
  el.micWarning.textContent = warning;
}

function statusLabel(current: SessionState): string {
  switch (current.status) {
    case 'idle':
      return tabId === null ? 'No target tab' : 'Ready to record';
    case 'recording':
      return `Recording — ${current.chunkCount} chunk(s)`;
    case 'processing':
      return current.progress
        ? `Transcribing ${current.progress.done}/${current.progress.total}…`
        : 'Finishing…';
    case 'done':
      return current.downloads.length > 0
        ? `Done — ${current.downloads.join(', ')}`
        : `Done — ${current.chunkCount} chunk(s), ${formatTimestamp(current.duration)}`;
    case 'error':
      return 'Error';
  }
}

function showError(message: string, micPermission: boolean): void {
  el.error.hidden = false;
  el.error.textContent = message;
  el.grantMic.hidden = !micPermission;
}

function hideError(): void {
  el.error.hidden = true;
  el.grantMic.hidden = true;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`element #${id} missing from popup`);
  return element as T;
}
