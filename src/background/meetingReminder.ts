/**
 * Rappel d'enregistrement : quand un onglet arrive sur une page reconnue comme
 * une visio, une notification système rappelle de lancer la capture.
 *
 * Elle ne peut pas *lancer* l'enregistrement : `tabCapture` exige `activeTab`,
 * qui n'est accordé que par un clic sur l'icône de l'extension (ou un raccourci
 * clavier), jamais par un clic sur une notification. Le clic sur la notification
 * fait donc le maximum de ce qui est possible — ramener l'utilisateur sur
 * l'onglet concerné — et le message dit le geste qui reste à faire.
 *
 * La reconnaissance d'URL elle-même vit dans `meetings/patterns` (module pur) :
 * ici, uniquement la plomberie `chrome`.
 */

import { loadConfig } from '@/config/storage';
import { matchMeetingUrl } from '@/meetings/patterns';

/** Motif ayant déclenché la notification, par onglet. En `storage.session` : le worker MV3 meurt. */
const NOTIFIED_KEY = 'meetingNotified';
const ID_PREFIX = 'meeting:';

interface ReminderHooks {
  /** Vrai si une session occupe déjà l'extension : rien à rappeler dans ce cas. */
  isSessionActive: () => Promise<boolean>;
}

export function registerMeetingReminder({ isSessionActive }: ReminderHooks): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // `status: 'complete'` couvre le chargement classique, `changeInfo.url` les
    // navigations d'une SPA (Teams, Meet) qui ne rechargent jamais la page.
    const url = changeInfo.url ?? (changeInfo.status === 'complete' ? tab.url : undefined);
    if (url === undefined) return;
    void onTabUrl(tabId, url, isSessionActive);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId);
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    const tabId = tabIdOf(notificationId);
    if (tabId === null) return;
    void focusTab(tabId);
    chrome.notifications.clear(notificationId);
  });
}

/**
 * Retire le rappel d'un onglet dont l'enregistrement vient de démarrer : le
 * laisser affiché demanderait de faire ce qui est déjà fait.
 */
export async function clearMeetingReminder(tabId: number): Promise<void> {
  await forgetTab(tabId);
}

async function onTabUrl(
  tabId: number,
  url: string,
  isSessionActive: () => Promise<boolean>,
): Promise<void> {
  const config = await loadConfig();
  if (!config.meetingReminder) return;

  const pattern = matchMeetingUrl(url, config.meetingPatterns);
  if (pattern === null) {
    // L'onglet a quitté la visio : le prochain retour doit re-notifier.
    await forgetTab(tabId);
    return;
  }

  // Tant que l'onglet reste sur le même motif, une seule notification : une SPA
  // change d'URL à chaque clic, et on ne veut pas en faire une pluie d'alertes.
  const notified = await readNotified();
  if (notified[tabId] === pattern) return;

  notified[tabId] = pattern;
  await chrome.storage.session.set({ [NOTIFIED_KEY]: notified });

  // Enregistrement déjà en cours : le motif est mémorisé (pas de rappel tardif
  // à l'arrêt), mais rien ne s'affiche.
  if (await isSessionActive()) return;

  chrome.notifications.create(`${ID_PREFIX}${tabId}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icon-rec-128.png'),
    title: 'OpenMeetRec',
    message: `Meeting page open on ${hostOf(url)} — click the OpenMeetRec icon to record it.`,
    // Le but est de ne pas oublier : la notification attend une action plutôt
    // que de disparaître au bout de quelques secondes.
    requireInteraction: true,
    silent: true,
  });
}

async function focusTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // Onglet fermé entre-temps : rien à faire.
  }
}

async function forgetTab(tabId: number): Promise<void> {
  const notified = await readNotified();
  if (!(tabId in notified)) return;
  delete notified[tabId];
  await chrome.storage.session.set({ [NOTIFIED_KEY]: notified });
  await chrome.notifications.clear(`${ID_PREFIX}${tabId}`);
}

async function readNotified(): Promise<Record<number, string>> {
  const stored = await chrome.storage.session.get(NOTIFIED_KEY);
  return (stored[NOTIFIED_KEY] as Record<number, string> | undefined) ?? {};
}

function tabIdOf(notificationId: string): number | null {
  if (!notificationId.startsWith(ID_PREFIX)) return null;
  const tabId = Number(notificationId.slice(ID_PREFIX.length));
  return Number.isInteger(tabId) ? tabId : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'this page';
  }
}
