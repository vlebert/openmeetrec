/**
 * OpenAI Whisper (F-TR-02).
 *
 * `verbose_json` est le seul format de réponse qui expose les segments ; c'est
 * aussi la raison pour laquelle `gpt-4o-transcribe`, qui ne les renvoie pas,
 * n'est pas proposé en preset (PRD §8).
 */

import { HttpTranscriptionProvider } from '@/providers/http';
import type { TranscribeOpts } from '@/shared/types';

export class OpenAiProvider extends HttpTranscriptionProvider {
  readonly id = 'openai' as const;

  protected buildForm(audio: Blob, opts: TranscribeOpts): FormData {
    const form = this.baseForm(audio, opts);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    return form;
  }
}
