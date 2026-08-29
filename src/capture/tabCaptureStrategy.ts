/**
 * Stratégie de capture Chromium (`chrome.tabCapture`).
 *
 * Seul fichier du projet autorisé à toucher `chrome.tabCapture`.
 */

import type { CaptureGrant, CaptureStrategy } from './strategy';

export class TabCaptureStrategy implements CaptureStrategy {
  readonly id = 'tabcapture' as const;

  /**
   * Nécessite un grant `activeTab` sur cet onglet : c'est l'ouverture du popup
   * depuis l'onglet de visio qui le fournit (PRD §3, F-CAP-03).
   */
  async requestGrant(tabId: number): Promise<CaptureGrant> {
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) reject(new Error(lastError.message));
        else if (!id) reject(new Error('empty stream id'));
        else resolve(id);
      });
    });
    return { strategy: this.id, streamId };
  }

  async openStream(grant: CaptureGrant): Promise<MediaStream> {
    // Contraintes `mandatory` héritées de l'ancienne API WebRTC : c'est la seule
    // forme que Chromium accepte pour consommer un streamId de tabCapture, elle
    // ne passe pas par le typage standard de MediaTrackConstraints.
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: grant.streamId,
        },
      },
      video: false,
    } as unknown as MediaStreamConstraints;
    return navigator.mediaDevices.getUserMedia(constraints);
  }
}
