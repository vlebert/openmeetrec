/**
 * Chunks → transcription parallèle → merge. Module PUR : l'accès à l'OPFS passe
 * par le callback `loadChunk`, ce qui rend le pipeline testable avec le
 * MockProvider et sans navigateur.
 */

import { chunkBoundaries, mergeSegments, mergeTexts, segmentsToText } from '@/audio/merge';
import { fitsInOneRequest, type TranscriptionLimits } from '@/providers/limits';
import { shouldFallBackToChunks } from '@/providers/retry';
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
  /** Vide hors mode segments : les sections par chunk n'ont de sens qu'avec des timestamps. */
  chunkBoundaries: number[];
}

export interface SingleRequestRun {
  /** Durée de l'enregistrement en secondes, pour la comparer aux limites. */
  duration: number;
  /** Piste continue de la session, ou `null` si elle n'a pas été écrite. */
  loadTrack(): Promise<Blob | null>;
  limits: TranscriptionLimits;
  provider: TranscriptionProvider;
  opts: TranscribeOpts;
}

/**
 * Transcrit tout l'enregistrement en **une seule requête**.
 *
 * C'est le chemin nominal quand le provider l'accepte : une seule passe de
 * diarization, donc des identités de speakers valables sur toute la réunion, là
 * où le chunking les réattribue à chaque frontière et les rend inaffichables
 * (cf. `shared/format.ts`, `hasGlobalSpeakers`).
 *
 * Renvoie `null` pour dire « replie-toi sur le chunking » : pas de piste, hors
 * des limites, ou échec que le découpage peut résoudre. Les échecs que le
 * découpage ne résoudra pas — clé invalide, quota épuisé — sont relancés tels
 * quels : les rejouer une fois par chunk ne ferait que brûler des requêtes.
 */
export async function runSingleRequest(run: SingleRequestRun): Promise<TranscriptionOutcome | null> {
  // La décision se prend sur la durée et la taille, connues avant l'appel : un
  // dépassement de limite ne doit jamais coûter un upload de plusieurs minutes.
  const track = await run.loadTrack();
  if (!track) return null;
  if (!fitsInOneRequest(run.limits, run.duration, track.size)) return null;

  let result;
  try {
    result = await run.provider.transcribe(track, run.opts);
  } catch (error) {
    if (!shouldFallBackToChunks(error)) throw error;
    return null;
  }

  const segments = result.segments ?? [];
  return {
    segments,
    text: segments.length > 0 ? segmentsToText(segments) : result.text,
    hadSegments: segments.length > 0,
    failedChunks: [],
    failures: [],
    transcribedCount: 1,
    // Aucune couture : c'est ce qui autorise l'export à nommer les speakers.
    chunkBoundaries: [],
  };
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

  // Un chunk sans segments (silence, pause) ne contribue simplement rien au
  // merge : la coupe à l'overlap des autres chunks ne dépend que des bornes de
  // `ChunkInfo`, pas du contenu du voisin. On ne bascule en mode texte brut que
  // si le provider n'a renvoyé de segments pour aucun chunk.
  const hadSegments = okSegments.some((segments) => segments.length > 0);

  if (!hadSegments) {
    return {
      segments: [],
      text: mergeTexts(okChunks, okTexts),
      hadSegments: false,
      failedChunks: failures.map((f) => f.index),
      failures,
      transcribedCount: okChunks.length,
      chunkBoundaries: [],
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
    chunkBoundaries: chunkBoundaries(okChunks),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
