/**
 * Mistral Voxtral (F-TR-01).
 *
 * `timestamp_granularities=segment` est demandé systématiquement, même sans
 * diarization : les timestamps sont ce qui permet au merge de couper au milieu
 * de l'overlap plutôt que de dupliquer 30 s de texte (PRD F-TR-04).
 */

import { ProviderError } from '@/providers/base';
import { HttpTranscriptionProvider } from '@/providers/http';
import { getLimits } from '@/providers/limits';
import type { TranscribeOpts } from '@/shared/types';

export class MistralProvider extends HttpTranscriptionProvider {
  readonly id = 'mistral' as const;

  protected buildForm(audio: Blob, opts: TranscribeOpts): FormData {
    const form = this.baseForm(audio, opts);
    form.append('timestamp_granularities', 'segment');
    if (opts.diarize && this.supportsDiarization) form.append('diarize', 'true');
    return form;
  }

  /**
   * Voxtral 3 compte la sortie dans sa fenêtre de contexte : un audio trop long
   * pour sa transcription est accepté puis coupé net, en HTTP 200, sans erreur
   * ni `finish_reason` distinctif. Seul `usage.total_tokens` qui atteint la
   * fenêtre le trahit. L'erreur levée fait repasser une requête unique en
   * chunks (`shouldFallBackToChunks`) au lieu d'exporter une réunion amputée.
   */
  protected override checkPayload(payload: unknown, opts: TranscribeOpts): void {
    const window = getLimits(this.id, opts.model).contextTokens;
    if (window === undefined) return;
    const usage = (payload as { usage?: { total_tokens?: unknown } } | null)?.usage;
    const total = usage?.total_tokens;
    if (typeof total === 'number' && total >= window) {
      throw new ProviderError(
        this.id,
        `transcription truncated: context window full (${total}/${window} tokens)`,
      );
    }
  }
}
