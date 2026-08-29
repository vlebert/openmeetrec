/**
 * Chunks → transcription parallèle → merge. Module PUR : l'accès à l'OPFS passe
 * par le callback `loadChunk`, ce qui rend le pipeline testable avec le
 * MockProvider et sans navigateur.
 */

import { mergeSegments, mergeTexts, segmentsToText } from '@/audio/merge';
import { DEFAULT_CONCURRENCY, mapLimitSettled } from '@/pipeline/concurrency';
import type { TranscriptionProvider } from '@/providers/base';
import type { ChunkInfo, Segment, TranscribeOpts } from '@/shared/types';

export interface TranscriptionRun {
  chunks: readonly ChunkInfo[];
  loadChunk(chunk: ChunkInfo): Promise<Blob>;
  provider: TranscriptionProvider;
  opts: TranscribeOpts;
  concurrency?: number;
  onProgress?(done: number, total: number): void;
}

export interface ChunkFailure {
  index: number;
  error: string;
}

export interface TranscriptionOutcome {
  /** Vide si aucun chunk n'a renvoyé de segments. */
  segments: Segment[];
  text: string;
  /** Faux dès qu'un chunk transcrit n'avait pas de segments : le merge dégrade. */
  hadSegments: boolean;
  failedChunks: number[];
  /** Raison de chaque échec — sans elle, un chunk perdu est indébogable. */
  failures: ChunkFailure[];
  /** Chunks effectivement transcrits. */
  transcribedCount: number;
}

export async function runTranscription(run: TranscriptionRun): Promise<TranscriptionOutcome> {
  const total = run.chunks.length;
  let done = 0;

  const settled = await mapLimitSettled(run.chunks, run.concurrency ?? DEFAULT_CONCURRENCY, async (chunk) => {
    const audio = await run.loadChunk(chunk);
    const result = await run.provider.transcribe(audio, run.opts);
    done += 1;
    run.onProgress?.(done, total);
    return result;
  });

  const okChunks: ChunkInfo[] = [];
  const okSegments: Segment[][] = [];
  const okTexts: string[] = [];
  const failures: ChunkFailure[] = [];

  settled.forEach((entry, index) => {
    const chunk = run.chunks[index];
    if (!chunk) return;
    if (entry.status === 'failed') {
      failures.push({ index: chunk.index, error: describeError(entry.error) });
      return;
    }
    okChunks.push(chunk);
    okSegments.push(entry.value.segments ?? []);
    okTexts.push(entry.value.text);
  });

  // Un seul chunk sans segments suffit à casser la coupe au milieu de l'overlap :
  // on bascule alors tout le document en mode texte, avec l'avertissement.
  const hadSegments = okChunks.length > 0 && okSegments.every((segments) => segments.length > 0);

  if (!hadSegments) {
    return {
      segments: [],
      text: mergeTexts(okChunks, okTexts),
      hadSegments: false,
      failedChunks: failures.map((f) => f.index),
      failures,
      transcribedCount: okChunks.length,
    };
  }

  const merged = mergeSegments(okChunks, okSegments);
  return {
    segments: merged,
    text: segmentsToText(merged),
    hadSegments: true,
    failedChunks: failures.map((f) => f.index),
    failures,
    transcribedCount: okChunks.length,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
