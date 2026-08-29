/**
 * Point d'extension Firefox — coquille vide en MVP (PRD §2, hors scope).
 *
 * Firefox n'a pas d'équivalent de `tabCapture` : la piste passera par un
 * content script qui intercepte les `RTCPeerConnection` de la page. Le jour où
 * on l'implémente, seul ce fichier bouge.
 */

import type { CaptureGrant, CaptureStrategy } from './strategy';

const UNSUPPORTED = 'Firefox capture not supported in MVP';

export class WebRtcStrategy implements CaptureStrategy {
  readonly id = 'webrtc' as const;

  requestGrant(_tabId: number): Promise<CaptureGrant> {
    return Promise.reject(new Error(UNSUPPORTED));
  }

  openStream(_grant: CaptureGrant): Promise<MediaStream> {
    return Promise.reject(new Error(UNSUPPORTED));
  }
}
