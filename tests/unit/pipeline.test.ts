import { describe, expect, it } from 'vitest';

import { planChunks } from '@/audio/chunking';
import { runTranscription } from '@/pipeline/pipeline';
import { MockProvider } from '@/providers/mock';
import type { TranscriptionProvider } from '@/providers/base';
import type { ChunkInfo, TranscribeOpts } from '@/shared/types';

const OPTS: TranscribeOpts = { model: 'mock', language: null, diarize: false };
const CHUNKS = planChunks(1000);

/** 5 ko → le MockProvider produit 5 segments de 10 s. */
const loadChunk = async (): Promise<Blob> => new Blob(['x'.repeat(5 * 1024)]);

describe('runTranscription', () => {
  it('transcrit tous les chunks et ramène les timestamps à l’absolu', async () => {
    const provider = new MockProvider();
    const outcome = await runTranscription({ chunks: CHUNKS, provider, loadChunk, opts: OPTS });

    expect(provider.calls).toBe(CHUNKS.length);
    expect(outcome.hadSegments).toBe(true);
    expect(outcome.failedChunks).toEqual([]);
    expect(outcome.segments[0]?.start).toBe(0);
    // Le chunk 1 démarre à 170 s ; son premier segment (170 s) est avant le
    // milieu de l'overlap (175 s) et n'est donc pas retenu, contrairement au
    // suivant (180 s).
    expect(outcome.segments.map((s) => s.start)).toContain(180);
    expect(outcome.segments.map((s) => s.start)).not.toContain(170);
  });

  it('rend des segments triés et sans doublon de frontière', async () => {
    const outcome = await runTranscription({ chunks: CHUNKS, provider: new MockProvider(), loadChunk, opts: OPTS });

    const starts = outcome.segments.map((s) => s.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(starts).size).toBe(starts.length);
  });

  // Un chunk perdu ne doit pas faire perdre la réunion entière (F-AUD-05).
  it('continue malgré un chunk en échec et le signale', async () => {
    const outcome = await runTranscription({
      chunks: CHUNKS,
      provider: failingOnSize(5 * 1024 + 1),
      // La taille identifie le chunk : les appels sont concurrents, leur ordre
      // d'arrivée chez le provider n'est pas garanti.
      loadChunk: async (chunk) => new Blob(['x'.repeat(5 * 1024 + chunk.index)]),
      opts: OPTS,
    });

    expect(outcome.failedChunks).toEqual([1]);
    expect(outcome.transcribedCount).toBe(CHUNKS.length - 1);
    expect(outcome.segments.length).toBeGreaterThan(0);
  });

  it('bascule en merge texte quand le provider ne renvoie pas de segments', async () => {
    const outcome = await runTranscription({
      chunks: CHUNKS,
      provider: new MockProvider({ segmentsDisabled: true }),
      loadChunk,
      opts: OPTS,
    });

    expect(outcome.hadSegments).toBe(false);
    expect(outcome.segments).toEqual([]);
    expect(outcome.text.length).toBeGreaterThan(0);
  });

  // F-TR-04 : un chunk silencieux ne doit pas faire perdre les timestamps de
  // toute la réunion (cf. bug rapporté en usage réel : Voxtral renvoie
  // `segments: []` sur du silence).
  it('un chunk sans segments ne fait pas perdre les timestamps des autres', async () => {
    const outcome = await runTranscription({
      chunks: CHUNKS,
      provider: emptyOnSize(5 * 1024 + 1),
      loadChunk: async (chunk) => new Blob(['x'.repeat(5 * 1024 + chunk.index)]),
      opts: OPTS,
    });

    expect(outcome.hadSegments).toBe(true);
    expect(outcome.failedChunks).toEqual([]);
    expect(outcome.transcribedCount).toBe(CHUNKS.length);
    expect(outcome.segments.length).toBeGreaterThan(0);
  });

  it('rapporte l’avancement au fil des chunks', async () => {
    const progress: number[] = [];
    await runTranscription({
      chunks: CHUNKS,
      provider: new MockProvider(),
      loadChunk,
      opts: OPTS,
      onProgress: (done) => progress.push(done),
    });

    expect(progress).toEqual(CHUNKS.map((_, i) => i + 1));
  });

  // Garde-fou : le pipeline ne demande que les chunks qu'on lui a donnés.
  it('n’invente pas de chunk', async () => {
    const seen: ChunkInfo[] = [];
    await runTranscription({
      chunks: CHUNKS.slice(0, 2),
      provider: new MockProvider(),
      loadChunk: async (chunk) => {
        seen.push(chunk);
        return new Blob(['x']);
      },
      opts: OPTS,
    });

    expect(seen.map((c) => c.index)).toEqual([0, 1]);
  });
});

function failingOnSize(size: number): TranscriptionProvider {
  const mock = new MockProvider();
  return {
    id: 'mock',
    supportsSegments: true,
    supportsDiarization: false,
    transcribe: async (audio, opts) => {
      if (audio.size === size) throw new Error('boom');
      return mock.transcribe(audio, opts);
    },
    testKey: async () => true,
  };
}

function emptyOnSize(size: number): TranscriptionProvider {
  const mock = new MockProvider();
  return {
    id: 'mock',
    supportsSegments: true,
    supportsDiarization: false,
    transcribe: async (audio, opts) => {
      if (audio.size === size) return { text: '', segments: [] };
      return mock.transcribe(audio, opts);
    },
    testKey: async () => true,
  };
}
