/**
 * Options de découpage utilisées à l'exécution.
 *
 * Isolées dans leur propre module pour deux raisons :
 *
 * 1. l'enregistrement et la transcription doivent partager *le même* objet, pas
 *    deux valeurs par défaut qui se trouvent coïncider — un chunk enregistré
 *    avec d'autres bornes que celles supposées au merge produirait un décalage
 *    silencieux des timestamps ;
 * 2. le build d'intégration alias ce module pour raccourcir les chunks, ce qui
 *    évite de faire durer un test cinq minutes.
 */

import { DEFAULT_CHUNK_OPTIONS } from '@/audio/chunking';
import type { ChunkOptions } from '@/shared/types';

export const RUNTIME_CHUNK_OPTIONS: ChunkOptions = DEFAULT_CHUNK_OPTIONS;
