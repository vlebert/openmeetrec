/**
 * Service worker MV3 — orchestration de la session.
 *
 * Squelette : la machine à états (idle → recording → processing → done), la
 * création de l'offscreen document et l'appel à `getMediaStreamId` arrivent dans
 * l'incrément suivant. Voir architecture §3.2.
 */

import { detectStrategyId } from '@/capture/detect';

chrome.runtime.onInstalled.addListener(() => {
  const strategy = detectStrategyId();
  if (strategy === null) {
    console.warn('[openmeetrec] aucune stratégie de capture disponible sur ce navigateur');
  }
});

// TODO(F-CAP-01/03) : messaging START_RECORDING { tabId } → getMediaStreamId → offscreen.
export {};
