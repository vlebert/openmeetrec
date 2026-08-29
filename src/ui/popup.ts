/**
 * UI — popup, surface de contrôle principale (PRD §3).
 *
 * Le popup est ouvert *depuis* l'onglet de visio : l'onglet actif est donc la
 * cible de capture, sans ambiguïté, et son ouverture fournit le grant
 * `activeTab` nécessaire à `tabCapture`.
 */

import { formatTimestamp } from '@/shared/format';
import type { Ack, AudioLevels, SessionState, ToOffscreenMessage, ToWorkerMessage } from '@/shared/messages';

const LEVELS_INTERVAL_MS = 150;

const el = {
  status: byId<HTMLParagraphElement>('status'),
  timer: byId<HTMLParagraphElement>('timer'),
  meters: byId<HTMLElement>('meters'),
  micLevel: byId<HTMLSpanElement>('mic-level'),
  tabLevel: byId<HTMLSpanElement>('tab-level'),
  micOption: byId<HTMLLabelElement>('mic-option'),
  micEnabled: byId<HTMLInputElement>('mic-enabled'),
  toggle: byId<HTMLButtonElement>('toggle'),
  error: byId<HTMLParagraphElement>('error'),
  grantMic: byId<HTMLButtonElement>('grant-mic'),
  platform: byId<HTMLElement>('platform'),
  options: byId<HTMLAnchorElement>('options'),
};

let tabId: number | null = null;
let tabUrl = '';
let state: SessionState | null = null;

el.toggle.addEventListener('click', () => void onToggle());
el.grantMic.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('ui/mic-permission.html') });
});
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
  await refresh();
  setInterval(() => void refresh(), LEVELS_INTERVAL_MS * 4);
  setInterval(() => void refreshLevels(), LEVELS_INTERVAL_MS);
}

async function onToggle(): Promise<void> {
  el.toggle.disabled = true;
  const recording = state?.status === 'recording';
  const message: ToWorkerMessage = recording
    ? { target: 'sw', type: 'STOP_RECORDING' }
    : { target: 'sw', type: 'START_RECORDING', tabId: tabId ?? -1, url: tabUrl, micEnabled: el.micEnabled.checked };
  const ack = (await chrome.runtime.sendMessage(message)) as Ack;
  if (!ack.ok && ack.error) showError(ack.error.message, ack.error.code === 'mic-permission');
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

  el.toggle.textContent = recording ? 'Arrêter' : 'Démarrer';
  el.toggle.disabled = busy || (!recording && tabId === null);
  el.status.textContent = statusLabel(current);
  el.timer.hidden = !recording;
  el.meters.hidden = !recording;
  el.micOption.hidden = recording || busy;
  el.micEnabled.disabled = recording || busy;

  if (current.error) showError(current.error.message, current.error.code === 'mic-permission');
  else hideError();

  if (recording && current.startedAt !== null) {
    el.timer.textContent = formatTimestamp((Date.now() - current.startedAt) / 1000);
    if (current.platform) el.platform.textContent = current.platform;
  }
}

function statusLabel(current: SessionState): string {
  switch (current.status) {
    case 'idle':
      return tabId === null ? 'Aucun onglet cible' : 'Prêt à enregistrer';
    case 'recording':
      return `Enregistrement — ${current.chunkCount} chunk(s)`;
    case 'processing':
      return 'Finalisation…';
    case 'done':
      return `Terminé — ${current.chunkCount} chunk(s), ${formatTimestamp(current.duration)}`;
    case 'error':
      return 'Erreur';
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
  if (!element) throw new Error(`élément #${id} absent du popup`);
  return element as T;
}
