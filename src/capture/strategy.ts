/**
 * Abstraction de la capture de l'audio distant.
 *
 * Règle projet : personne n'appelle `chrome.tabCapture` en dehors de `capture/`.
 * C'est ce qui permettra de brancher Firefox sans toucher au reste.
 */

export type CaptureStrategyId = 'tabcapture' | 'webrtc';

export interface CaptureStrategy {
  readonly id: CaptureStrategyId;
  /** Démarre la capture de l'onglet désigné et renvoie le flux audio distant. */
  start(tabId: number): Promise<MediaStream>;
  stop(): void;
}
