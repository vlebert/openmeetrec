/**
 * Socle commun des providers HTTP : multipart, en-tête d'auth, retry, parsing.
 *
 * Les trois providers réseau ne diffèrent que par les champs du formulaire, le
 * reste (gestion des statuts, backoff, lecture de la réponse) est identique.
 */

import { ProviderError, type TranscriptionProvider } from '@/providers/base';
import { parseTranscription } from '@/providers/parse';
import { withRetry } from '@/providers/retry';
import type { ProviderId, TranscribeOpts, TranscriptionResult } from '@/shared/types';

const AUDIO_FILENAME = 'audio.webm';
/** Tronque le corps d'erreur : inutile de propager une page HTML entière. */
const ERROR_BODY_MAX = 300;

export interface HttpProviderOptions {
  endpoint: string;
  apiKey: string;
  supportsSegments: boolean;
  supportsDiarization: boolean;
  /** Injecté dans les tests ; par défaut le `fetch` global. */
  fetchImpl?: typeof fetch;
}

export abstract class HttpTranscriptionProvider implements TranscriptionProvider {
  abstract readonly id: Exclude<ProviderId, 'mock'>;

  constructor(protected readonly options: HttpProviderOptions) {}

  get supportsSegments(): boolean {
    return this.options.supportsSegments;
  }

  get supportsDiarization(): boolean {
    return this.options.supportsDiarization;
  }

  async transcribe(audio: Blob, opts: TranscribeOpts): Promise<TranscriptionResult> {
    const payload = await withRetry(() => this.post(this.options.endpoint, this.buildForm(audio, opts)));
    return parseTranscription(payload);
  }

  /**
   * Valide la clé sans consommer de crédit : `GET ../models` relativement à
   * l'endpoint de transcription, ce qui donne `/v1/models` pour Mistral comme
   * pour OpenAI. Un endpoint custom qui ne suit pas cette convention renverra
   * `false` sans que la clé soit forcément mauvaise.
   */
  async testKey(): Promise<boolean> {
    let url: string;
    try {
      url = new URL('../models', this.options.endpoint).toString();
    } catch {
      return false;
    }
    try {
      const response = await this.fetch(url, { method: 'GET', headers: this.authHeaders() });
      return response.ok;
    } catch {
      return false;
    }
  }

  protected abstract buildForm(audio: Blob, opts: TranscribeOpts): FormData;

  protected baseForm(audio: Blob, opts: TranscribeOpts): FormData {
    const form = new FormData();
    form.append('file', audio, AUDIO_FILENAME);
    form.append('model', opts.model);
    if (opts.language) form.append('language', opts.language);
    return form;
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.apiKey}` };
  }

  private async post(url: string, body: FormData): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(url, { method: 'POST', headers: this.authHeaders(), body });
    } catch (error) {
      // Pas de statut : erreur réseau, donc réessayable.
      throw new ProviderError(this.id, error instanceof Error ? error.message : String(error));
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        this.id,
        `HTTP ${response.status} — ${detail.slice(0, ERROR_BODY_MAX)}`,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError(this.id, `réponse JSON invalide : ${String(error)}`, response.status);
    }
  }

  private get fetch(): typeof fetch {
    return this.options.fetchImpl ?? globalThis.fetch;
  }
}
