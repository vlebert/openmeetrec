/**
 * Abstraction de la capture de l'audio distant.
 *
 * Règle projet : personne n'appelle `chrome.tabCapture` en dehors de `capture/`.
 * C'est ce qui permettra de brancher Firefox sans toucher au reste.
 *
 * L'interface est en deux temps parce que la capture Chromium l'est aussi :
 * l'autorisation s'obtient dans le service worker (seul contexte qui connaît le
 * `tabId`), le flux s'ouvre dans l'offscreen document (seul contexte qui a un
 * DOM et peut tenir un `MediaStream`). Le jeton fait le pont entre les deux.
 */

export type CaptureStrategyId = 'tabcapture' | 'webrtc';

/** Jeton de capture, produit côté service worker, consommé côté offscreen. */
export interface CaptureGrant {
  strategy: CaptureStrategyId;
  /** Identifiant opaque de flux, sérialisable dans un message. */
  streamId: string;
}

export interface CaptureStrategy {
  readonly id: CaptureStrategyId;
  /** Côté service worker : autorise la capture de l'onglet désigné. */
  requestGrant(tabId: number): Promise<CaptureGrant>;
  /** Côté offscreen : ouvre le flux audio distant à partir du jeton. */
  openStream(grant: CaptureGrant): Promise<MediaStream>;
}
