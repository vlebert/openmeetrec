import { describe, expect, it, vi } from 'vitest';

import { ProviderError } from '@/providers/base';
import { MistralProvider } from '@/providers/mistral';
import { OpenAiProvider } from '@/providers/openai';
import type { TranscribeOpts } from '@/shared/types';

const OPTS: TranscribeOpts = { model: 'm', language: 'fr', diarize: true };
const RESPONSE = { text: 'ok', segments: [{ text: 'ok', start: 0, end: 1 }] };

function stubFetch(payload: unknown = RESPONSE, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function fieldsOf(call: [string | URL | Request, (RequestInit | undefined)?]): Record<string, string[]> {
  const body = call[1]?.body as FormData;
  const fields: Record<string, string[]> = {};
  for (const [key, value] of body.entries()) {
    (fields[key] ??= []).push(value instanceof File ? `file:${value.name}` : String(value));
  }
  return fields;
}

describe('providers HTTP', () => {
  it('Mistral demande toujours des segments, et la diarization si activée', async () => {
    const fetchImpl = stubFetch();
    const provider = new MistralProvider({
      endpoint: 'https://api.mistral.ai/v1/audio/transcriptions',
      apiKey: 'k',
      supportsSegments: true,
      supportsDiarization: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.transcribe(new Blob(['audio']), OPTS);

    const fields = fieldsOf(fetchImpl.mock.calls[0]!);
    expect(fields['timestamp_granularities']).toEqual(['segment']);
    expect(fields['diarize']).toEqual(['true']);
    expect(fields['language']).toEqual(['fr']);
    expect(fields['file']).toEqual(['file:audio.webm']);
  });

  it("n'envoie pas diarize quand le provider ne sait pas le faire", async () => {
    const fetchImpl = stubFetch();
    const provider = new OpenAiProvider({
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      apiKey: 'k',
      supportsSegments: true,
      supportsDiarization: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.transcribe(new Blob(['audio']), OPTS);

    const fields = fieldsOf(fetchImpl.mock.calls[0]!);
    expect(fields['diarize']).toBeUndefined();
    expect(fields['response_format']).toEqual(['verbose_json']);
    expect(fields['timestamp_granularities[]']).toEqual(['segment']);
  });

  it('porte la clé dans l’en-tête Authorization', async () => {
    const fetchImpl = stubFetch();
    const provider = new MistralProvider({
      endpoint: 'https://api.mistral.ai/v1/audio/transcriptions',
      apiKey: 'secret',
      supportsSegments: true,
      supportsDiarization: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.transcribe(new Blob(['a']), OPTS);

    const headers = fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret');
  });

  // Une clé invalide ne doit pas être réessayée : 4 tentatives ne la rendront
  // pas valide, et chacune coûte une seconde d'attente à l'utilisateur.
  it('abandonne immédiatement sur 401', async () => {
    const fetchImpl = stubFetch({ error: 'unauthorized' }, { status: 401 });
    const provider = new MistralProvider({
      endpoint: 'https://api.mistral.ai/v1/audio/transcriptions',
      apiKey: 'mauvaise',
      supportsSegments: true,
      supportsDiarization: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.transcribe(new Blob(['a']), OPTS)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dérive l’URL des modèles depuis l’endpoint pour tester la clé', async () => {
    const fetchImpl = stubFetch({});
    const provider = new OpenAiProvider({
      endpoint: 'https://api.openai.com/v1/audio/transcriptions',
      apiKey: 'k',
      supportsSegments: true,
      supportsDiarization: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.testKey()).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.openai.com/v1/models');
  });
});

// Régression : sans `bind`, le `fetch` natif appelé comme méthode du provider
// lève « Illegal invocation » dans le navigateur. Les autres tests injectent
// tous un `fetchImpl`, donc aucun ne couvrait le chemin par défaut.
describe('fetch par défaut', () => {
  it('utilise le fetch global sans casser son contexte', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = function boundCheck(this: unknown, input: string | URL | Request) {
      if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation');
      calls.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify(RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    } as unknown as typeof fetch;

    try {
      const provider = new MistralProvider({
        endpoint: 'https://api.mistral.ai/v1/audio/transcriptions',
        apiKey: 'k',
        supportsSegments: true,
        supportsDiarization: true,
      });
      await expect(provider.transcribe(new Blob(['a']), OPTS)).resolves.toMatchObject({ text: 'ok' });
      expect(calls).toEqual(['https://api.mistral.ai/v1/audio/transcriptions']);
    } finally {
      globalThis.fetch = original;
    }
  });
});
