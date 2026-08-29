/**
 * Merge des transcriptions de chunks qui se recouvrent. Module PUR.
 *
 * Port de `merge_segments` / `merge_texts` / `_adjust_timestamps`
 * (supervoxtral, svx/core/chunking.py).
 *
 * Le chemin nominal est `mergeSegments` : la coupe au milieu de la zone
 * d'overlap élimine le texte dupliqué sans avoir besoin d'une passe LLM.
 * `mergeTexts` n'est qu'un fallback pour les providers sans timestamps, et
 * laisse des doublons aux frontières (cf. PRD F-TR-07).
 */

import type { ChunkInfo, Segment } from '@/shared/types';

/** Décale les timestamps d'un chunk vers l'échelle absolue de l'enregistrement. */
export function adjustTimestamps(chunk: ChunkInfo, segments: readonly Segment[]): Segment[] {
  const offset = chunk.start;
  if (offset === 0) return segments.map((seg) => ({ ...seg }));
  return segments.map((seg) => ({
    ...seg,
    start: seg.start + offset,
    end: seg.end + offset,
  }));
}

/** Milieu de la zone d'overlap entre deux chunks consécutifs. */
function overlapMidpoint(previous: ChunkInfo, next: ChunkInfo): number {
  return previous.end - (previous.end - next.start) / 2;
}

/**
 * Timestamp absolu à partir duquel chaque chunk, à partir du deuxième,
 * commence à contribuer au texte fusionné (mêmes bornes que `mergeSegments`,
 * pour que les sections affichées dans l'export correspondent exactement à ce
 * qui a été retenu de chaque chunk).
 */
export function chunkBoundaries(chunks: readonly ChunkInfo[]): number[] {
  const bounds: number[] = [];
  for (let i = 1; i < chunks.length; i += 1) {
    bounds.push(overlapMidpoint(chunks[i - 1]!, chunks[i]!));
  }
  return bounds;
}

/**
 * Fusionne les segments de chunks recouvrants en une liste unique.
 *
 * Pour chaque zone d'overlap, on garde les segments du chunk de gauche jusqu'au
 * milieu de l'overlap, puis ceux du chunk de droite. Chaque segment est donc
 * attribué à un seul chunk, ce qui supprime les doublons.
 */
export function mergeSegments(
  chunks: readonly ChunkInfo[],
  chunkResults: readonly (readonly Segment[])[],
): Segment[] {
  if (chunks.length !== chunkResults.length) {
    throw new Error('chunks et chunkResults doivent avoir la même longueur');
  }
  if (chunks.length === 0) return [];
  if (chunks.length === 1) return adjustTimestamps(chunks[0]!, chunkResults[0]!);

  const merged: Segment[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const adjusted = adjustTimestamps(chunk, chunkResults[i]!);

    const lowerBound = i === 0 ? -Infinity : overlapMidpoint(chunks[i - 1]!, chunk);
    const upperBound =
      i === chunks.length - 1 ? Infinity : overlapMidpoint(chunk, chunks[i + 1]!);

    for (const seg of adjusted) {
      if (seg.start >= lowerBound && seg.start < upperBound) merged.push(seg);
    }
  }

  merged.sort((a, b) => a.start - b.start);
  return merged;
}

/**
 * Concaténation brute des textes de chunks — fallback quand le provider ne
 * renvoie pas de timestamps.
 *
 * Laisse le texte de la zone d'overlap en double à chaque frontière : c'est une
 * limitation assumée, signalée à l'utilisateur dans le markdown exporté.
 */
export function mergeTexts(chunks: readonly ChunkInfo[], texts: readonly string[]): string {
  if (chunks.length !== texts.length) {
    throw new Error('chunks et texts doivent avoir la même longueur');
  }
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join('\n\n');
}

/** Texte continu reconstruit à partir de segments déjà fusionnés. */
export function segmentsToText(segments: readonly Segment[]): string {
  return segments
    .map((seg) => seg.text.trim())
    .filter((t) => t.length > 0)
    .join(' ');
}

/** Identifiants de speakers distincts rencontrés dans les segments. */
export function countSpeakers(segments: readonly Segment[]): number {
  const ids = new Set<string>();
  for (const seg of segments) {
    if (seg.speakerId !== undefined) ids.add(seg.speakerId);
  }
  return ids.size;
}
