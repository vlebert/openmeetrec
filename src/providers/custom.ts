/**
 * Endpoint libre, supposé compatible avec l'API OpenAI (F-TR-03).
 *
 * Les capacités ne sont pas devinées : elles viennent de ce que l'utilisateur a
 * déclaré dans les options, et un endpoint déclaré sans segments bascule le
 * merge en mode texte avec l'avertissement correspondant.
 */

import { HttpTranscriptionProvider } from '@/providers/http';
import type { TranscribeOpts } from '@/shared/types';

export class CustomProvider extends HttpTranscriptionProvider {
  readonly id = 'custom' as const;

  protected buildForm(audio: Blob, opts: TranscribeOpts): FormData {
    const form = this.baseForm(audio, opts);
    if (this.supportsSegments) {
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
    }
    return form;
  }
}
