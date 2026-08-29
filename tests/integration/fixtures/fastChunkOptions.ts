/**
 * Durées de chunk du build d'intégration : 20 s au lieu de 5 min, 5 s
 * d'overlap au lieu de 30 s.
 *
 * Les proportions sont conservées (overlap = un quart du pas), donc la
 * mécanique testée est bien celle de production — seule l'échelle change.
 */

import type { ChunkOptions } from '@/shared/types';

export const RUNTIME_CHUNK_OPTIONS: ChunkOptions = {
  chunkDuration: 20,
  overlap: 5,
};
