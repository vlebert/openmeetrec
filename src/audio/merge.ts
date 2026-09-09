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

/** Paragraphe horodaté sans notion de speaker (garde le timestamp du 1er segment). */
export interface Paragraph {
  start: number;
  end: number;
  text: string;
}

/** Un paragraphe se clôt sur une fin de phrase dès qu'il dépasse cette durée. */
const PARAGRAPH_MIN_SECONDS = 20;
/** …ou dès qu'un silence dépasse ça, fin de phrase ou pas. */
const PARAGRAPH_GAP_SECONDS = 2;
const SENTENCE_END = /[.!?…]["'»)\]]?\s*$/;

/**
 * Regroupe des segments horodatés (sans diarization) en paragraphes lisibles :
 * un paragraphe se ferme sur une fin de phrase une fois passé ~20 s, sur un
 * silence de plus de 2 s, ou à une frontière de chunk. Sans ça, l'export d'un
 * provider non-diarizant serait un mur de texte (ou, avec une seule requête, un
 * unique paragraphe).
 */
export function groupSegmentsIntoParagraphs(
  segments: readonly Segment[],
  chunkBoundaries: readonly number[] = [],
): Paragraph[] {
  interface Open {
    start: number;
    end: number;
    texts: string[];
    boundaryIndex: number;
  }

  const open: Open[] = [];
  let boundaryIndex = 0;

  for (const seg of segments) {
    const text = seg.text.trim();
    while (boundaryIndex < chunkBoundaries.length && seg.start >= chunkBoundaries[boundaryIndex]!) {
      boundaryIndex += 1;
    }

    const current = open[open.length - 1];
    const closedBySentence =
      current !== undefined &&
      current.end - current.start >= PARAGRAPH_MIN_SECONDS &&
      SENTENCE_END.test(current.texts[current.texts.length - 1] ?? '');
    const sameParagraph =
      current !== undefined &&
      current.boundaryIndex === boundaryIndex &&
      seg.start - current.end <= PARAGRAPH_GAP_SECONDS &&
      !closedBySentence;

    if (sameParagraph) {
      current.end = seg.end;
      if (text.length > 0) current.texts.push(text);
    } else {
      open.push({ start: seg.start, end: seg.end, texts: text.length > 0 ? [text] : [], boundaryIndex });
    }
  }

  return open
    .filter((p) => p.texts.length > 0)
    .map(({ start, end, texts }) => ({ start, end, text: texts.join(' ') }));
}

/** Identifiants de speakers distincts rencontrés dans les segments. */
export function countSpeakers(segments: readonly Segment[]): number {
  const ids = new Set<string>();
  for (const seg of segments) {
    if (seg.speakerId !== undefined) ids.add(seg.speakerId);
  }
  return ids.size;
}

/** Tour de parole consolidé : segments consécutifs d'un même speaker regroupés en un seul texte. */
export interface SpeakerTurn {
  speakerId: string | undefined;
  start: number;
  end: number;
  text: string;
}

/**
 * Regroupe les segments consécutifs d'un même speaker en tours de parole
 * (port de `format_diarized_transcript`, supervoxtral svx/core/formatting.py).
 *
 * `chunkBoundaries` (cf. `chunkBoundaries` ci-dessus) empêche de fusionner deux
 * segments situés de part et d'autre d'une frontière de chunk : les speaker IDs
 * sont attribués indépendamment par chunk, donc "Speaker 0" avant et après une
 * frontière ne sont pas garantis être la même personne. Une frontière force donc
 * un nouveau tour même si le speakerId est identique. C'est aussi pour ça que
 * l'export masque les libellés dès qu'il y a une couture (`shared/format.ts`,
 * `hasGlobalSpeakers`) : la diarization n'y sert plus qu'à découper en
 * paragraphes.
 */
export function groupSegmentsBySpeaker(
  segments: readonly Segment[],
  chunkBoundaries: readonly number[] = [],
): SpeakerTurn[] {
  interface OpenTurn {
    speakerId: string | undefined;
    start: number;
    end: number;
    texts: string[];
    chunkIndex: number;
  }

  const turns: OpenTurn[] = [];
  let chunkIndex = 0;

  for (const seg of segments) {
    while (chunkIndex < chunkBoundaries.length && seg.start >= chunkBoundaries[chunkIndex]!) {
      chunkIndex += 1;
    }

    const current = turns[turns.length - 1];
    const text = seg.text.trim();
    if (current && current.speakerId === seg.speakerId && current.chunkIndex === chunkIndex) {
      current.end = seg.end;
      if (text.length > 0) current.texts.push(text);
    } else {
      turns.push({ speakerId: seg.speakerId, start: seg.start, end: seg.end, texts: text ? [text] : [], chunkIndex });
    }
  }

  return turns.map(({ speakerId, start, end, texts }) => ({
    speakerId,
    start,
    end,
    text: texts.join(' '),
  }));
}
