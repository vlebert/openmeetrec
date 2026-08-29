/**
 * Mistral Voxtral (F-TR-01).
 *
 * `timestamp_granularities=segment` est demandé systématiquement, même sans
 * diarization : les timestamps sont ce qui permet au merge de couper au milieu
 * de l'overlap plutôt que de dupliquer 30 s de texte (PRD F-TR-04).
 */

import { HttpTranscriptionProvider } from '@/providers/http';
import type { TranscribeOpts } from '@/shared/types';

export class MistralProvider extends HttpTranscriptionProvider {
  readonly id = 'mistral' as const;

  protected buildForm(audio: Blob, opts: TranscribeOpts): FormData {
    const form = this.baseForm(audio, opts);
    form.append('timestamp_granularities', 'segment');
    if (opts.diarize && this.supportsDiarization) form.append('diarize', 'true');
    return form;
  }
}
