/**
 * Interface commune des providers de transcription. Module PUR.
 */

import type { ProviderId, TranscribeOpts, TranscriptionResult } from '@/shared/types';

export interface TranscriptionProvider {
  readonly id: ProviderId;
  /** Le provider renvoie-t-il des segments horodatés ? Conditionne la qualité du merge. */
  readonly supportsSegments: boolean;
  /** Le provider attribue-t-il un `speakerId` aux segments ? */
  readonly supportsDiarization: boolean;
  transcribe(audio: Blob, opts: TranscribeOpts): Promise<TranscriptionResult>;
  /** Appel léger pour valider une clé API depuis la page d'options. */
  testKey(): Promise<boolean>;
}

/** Erreur normalisée, porteuse du statut HTTP quand il y en a un. */
export class ProviderError extends Error {
  readonly status: number | undefined;
  readonly providerId: ProviderId;

  constructor(providerId: ProviderId, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.status = status;
  }
}
