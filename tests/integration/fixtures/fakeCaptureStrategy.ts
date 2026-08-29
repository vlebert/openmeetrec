/**
 * Stratégie de capture substituée dans le build d'intégration.
 *
 * `chrome.tabCapture` exige un grant `activeTab`, qui n'est accordé que si
 * l'utilisateur invoque réellement l'extension (clic sur l'icône, raccourci,
 * menu contextuel). Playwright ne pilote pas l'UI du navigateur, et
 * `chrome.action.openPopup()` ne l'accorde pas non plus : le vrai appel
 * `tabCapture` est donc hors de portée d'un test automatisé (architecture §10.3)
 * et reste un point de vérification manuelle.
 *
 * Ce qui vient *après* le grant — mix, ré-injection, recorders décalés, OPFS,
 * transcription, merge, export — est identique et bien exercé par le test.
 *
 * Le flux vient du périphérique factice de Chromium
 * (`--use-fake-device-for-media-stream`).
 */

import type { CaptureGrant, CaptureStrategy } from '@/capture/strategy';

export class TabCaptureStrategy implements CaptureStrategy {
  readonly id = 'tabcapture' as const;

  async requestGrant(tabId: number): Promise<CaptureGrant> {
    return { strategy: this.id, streamId: `fake-tab-${tabId}` };
  }

  async openStream(_grant: CaptureGrant): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
}
