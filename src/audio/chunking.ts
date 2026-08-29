/**
 * Planification des chunks. Module PUR : pas de `chrome`, pas de DOM.
 *
 * Le découpage réel est produit au fil de l'eau par `audio/chunkScheduler.ts`
 * (deux MediaRecorder décalés). Ce module est la source de vérité qui dit quels
 * chunks doivent exister pour une durée donnée — il sert à la fois à afficher la
 * progression (« chunk N/M »), à écarter un dernier chunk dégénéré, et d'oracle
 * dans les tests du scheduler.
 *
 * Port de `split_audio` (supervoxtral, svx/core/chunking.py).
 */

import type { ChunkInfo, ChunkOptions } from '@/shared/types';

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkDuration: 300,
  overlap: 30,
};

export function assertValidChunkOptions(opts: ChunkOptions): void {
  if (!(opts.chunkDuration > 0)) {
    throw new RangeError('chunkDuration doit être strictement positif');
  }
  if (opts.overlap < 0) {
    throw new RangeError("overlap ne peut pas être négatif");
  }
  if (opts.overlap >= opts.chunkDuration) {
    throw new RangeError('overlap doit être strictement inférieur à chunkDuration');
  }
}

/** Pas entre les débuts de deux chunks consécutifs. */
export function chunkStep(opts: ChunkOptions): number {
  assertValidChunkOptions(opts);
  return opts.chunkDuration - opts.overlap;
}

/** Instant de départ du chunk `index`, en secondes. */
export function chunkStartTime(index: number, opts: ChunkOptions): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("index de chunk invalide");
  }
  return index * chunkStep(opts);
}

/**
 * Liste les chunks attendus pour un enregistrement de `totalDuration` secondes.
 *
 * Un enregistrement plus court qu'un chunk donne un chunk unique couvrant tout.
 * La boucle s'arrête dès qu'un chunk atteint la fin, ce qui évite les chunks
 * dégénérés entièrement contenus dans la zone d'overlap du précédent.
 */
export function planChunks(
  totalDuration: number,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): ChunkInfo[] {
  assertValidChunkOptions(opts);
  if (!(totalDuration > 0)) return [];

  if (totalDuration <= opts.chunkDuration) {
    return [{ index: 0, start: 0, end: totalDuration }];
  }

  const step = chunkStep(opts);
  const chunks: ChunkInfo[] = [];
  let start = 0;
  let index = 0;

  while (start < totalDuration) {
    const end = Math.min(start + opts.chunkDuration, totalDuration);
    chunks.push({ index, start, end });
    if (end >= totalDuration) break;
    index += 1;
    start += step;
  }

  return chunks;
}

/** Nombre de chunks attendus pour une durée donnée. */
export function expectedChunkCount(
  totalDuration: number,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): number {
  return planChunks(totalDuration, opts).length;
}

/**
 * Dit si le chunk `index` doit être conservé pour un enregistrement de
 * `totalDuration` secondes.
 *
 * Le scheduler démarre un recorder toutes les `step` secondes sans savoir quand
 * l'utilisateur va cliquer sur Stop. Si le Stop tombe dans la zone d'overlap, le
 * dernier recorder produit un chunk entièrement contenu dans le précédent : il
 * n'apporte rien et polluerait le merge, donc on l'écarte.
 */
export function isChunkNeeded(
  index: number,
  totalDuration: number,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): boolean {
  return index < expectedChunkCount(totalDuration, opts);
}
