/**
 * Limites d'envoi du build d'intégration.
 *
 * En production, le provider `custom` a des limites inconnues et part donc
 * toujours en chunks (`src/providers/limits.ts`) — ce qui rendrait le chemin
 * « une seule requête » inatteignable depuis l'e2e, alors que c'est lui qui
 * change le comportement du produit. Le modèle `mock-one-shot` l'autorise ; tout
 * autre modèle garde exactement le comportement de production.
 *
 * L'import est relatif, pas en `@/` : l'alias du build de test pointe
 * `@/providers/limits` vers ce fichier, qui s'importerait donc lui-même.
 */

import {
  getLimits as productionLimits,
  type TranscriptionLimits,
} from '../../../src/providers/limits';
import type { ProviderId } from '@/shared/types';

export { DEFAULT_LIMITS, fitsInOneRequest } from '../../../src/providers/limits';
export type { TranscriptionLimits } from '../../../src/providers/limits';

/** Doit rester identique à `ONE_SHOT_MODEL` dans `record.spec.ts`. */
const ONE_SHOT_MODEL = 'mock-one-shot';

const ONE_SHOT_LIMITS: TranscriptionLimits = {
  maxSingleRequestSeconds: 60 * 60,
  maxSingleRequestBytes: 100 * 1024 * 1024,
};

export function getLimits(
  provider: Exclude<ProviderId, 'mock'>,
  model: string,
): TranscriptionLimits {
  if (provider === 'custom' && model === ONE_SHOT_MODEL) return ONE_SHOT_LIMITS;
  return productionLimits(provider, model);
}
