/**
 * Point d'extension Firefox — non implémenté en MVP.
 *
 * L'implémentation future interceptera les `RTCPeerConnection` en MAIN world
 * pour récupérer les pistes distantes, Firefox n'ayant pas d'équivalent à
 * `chrome.tabCapture`. La coquille existe pour figer le contrat côté
 * `CaptureStrategy` sans faire de place spéciale à Chromium dans le reste du code.
 */

import type { CaptureStrategy } from './strategy';

export class WebRTCStrategy implements CaptureStrategy {
  readonly id = 'webrtc' as const;

  async start(_tabId: number): Promise<MediaStream> {
    throw new Error('Capture Firefox non supportée en MVP (interception WebRTC à venir).');
  }

  stop(): void {
    // Rien à arrêter tant que `start` throw.
  }
}
