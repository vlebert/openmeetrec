/**
 * Choix de la stratégie de capture par feature detection.
 *
 * Seul module de `capture/` testable sans navigateur : il ne fait que regarder
 * les API présentes sur `globalThis`, ce qu'un test peut simuler.
 */

import type { CaptureStrategyId } from './strategy';

interface CaptureGlobals {
  chrome?: { tabCapture?: unknown };
}

/**
 * Identifie la stratégie utilisable dans l'environnement courant, ou `null` si
 * aucune ne l'est. Ne construit rien : la détection reste pure, l'instanciation
 * est faite par l'appelant.
 */
export function detectStrategyId(scope: CaptureGlobals = globalThis): CaptureStrategyId | null {
  if (scope.chrome?.tabCapture) return 'tabcapture';
  // Firefox plus tard : if (supportsMainWorld(scope)) return 'webrtc';
  return null;
}

export function isCaptureSupported(scope: CaptureGlobals = globalThis): boolean {
  return detectStrategyId(scope) !== null;
}
