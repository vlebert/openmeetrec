/**
 * Provider déterministe pour les tests. Aucun accès réseau, aucune clé API.
 *
 * Obligatoire pour tous les tests d'intégration (règle projet).
 */

import type { TranscribeOpts, TranscriptionResult } from '@/shared/types';
import type { TranscriptionProvider } from './base';

export interface MockProviderOptions {
  /** Phrases servies en boucle, une par segment. */
  phrases?: string[];
  /** Durée d'un segment simulé, en secondes. */
  segmentDuration?: number;
  /** Nombre de speakers simulés en diarization. */
  speakerCount?: number;
  /** Force l'absence de segments, pour tester le fallback texte. */
  segmentsDisabled?: boolean;
}

const DEFAULT_PHRASES = [
  'Bonjour à tous, on peut commencer.',
  "Je fais un point rapide sur l'avancement.",
  'On a bouclé la première étape hier soir.',
  'Est-ce que quelqu un a des questions ?',
  'Très bien, on se recale la semaine prochaine.',
];

export class MockProvider implements TranscriptionProvider {
  readonly id = 'mock' as const;
  readonly supportsSegments: boolean;
  readonly supportsDiarization = true;

  private readonly phrases: string[];
  private readonly segmentDuration: number;
  private readonly speakerCount: number;

  /** Nombre d'appels reçus — pratique pour vérifier la concurrence en test. */
  calls = 0;

  constructor(options: MockProviderOptions = {}) {
    this.phrases = options.phrases ?? DEFAULT_PHRASES;
    this.segmentDuration = options.segmentDuration ?? 10;
    this.speakerCount = options.speakerCount ?? 2;
    this.supportsSegments = !(options.segmentsDisabled ?? false);
  }

  async transcribe(audio: Blob, opts: TranscribeOpts): Promise<TranscriptionResult> {
    this.calls += 1;

    // Le contenu dépend uniquement de la taille du blob : même entrée, même sortie.
    const count = Math.max(1, Math.min(this.phrases.length, Math.ceil(audio.size / 1024) || 1));
    const segments = Array.from({ length: count }, (_, i) => {
      const segment: { text: string; start: number; end: number; speakerId?: string } = {
        text: this.phrases[i % this.phrases.length]!,
        start: i * this.segmentDuration,
        end: (i + 1) * this.segmentDuration,
      };
      if (opts.diarize) segment.speakerId = String(i % this.speakerCount);
      return segment;
    });

    const text = segments.map((s) => s.text).join(' ');
    return this.supportsSegments ? { text, segments } : { text };
  }

  async testKey(): Promise<boolean> {
    return true;
  }
}
