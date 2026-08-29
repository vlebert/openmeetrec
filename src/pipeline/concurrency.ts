/**
 * Sémaphore minimal pour la transcription parallèle. Module PUR.
 *
 * Port de `_transcribe_chunked` (supervoxtral) qui utilise un ThreadPool.
 */

export const DEFAULT_CONCURRENCY = 4;

/**
 * Applique `fn` à chaque élément, au plus `limit` en vol simultanément.
 *
 * L'ordre des résultats suit celui des entrées, indépendamment de l'ordre
 * d'achèvement. Si `fn` rejette, l'erreur est propagée après que les tâches déjà
 * démarrées se soient terminées, et aucune nouvelle tâche n'est lancée.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit doit être un entier >= 1');
  }
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failure: unknown;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  if (failed) throw failure;
  return results;
}

/**
 * Variante tolérante aux échecs : chaque élément donne un succès ou une erreur,
 * et un échec n'annule jamais les autres. C'est ce que veut le pipeline — un
 * chunk raté ne doit pas faire perdre toute la réunion.
 */
export async function mapLimitSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<({ status: 'ok'; value: R } | { status: 'failed'; error: unknown })[]> {
  return mapLimit(items, limit, async (item, index) => {
    try {
      return { status: 'ok' as const, value: await fn(item, index) };
    } catch (error) {
      return { status: 'failed' as const, error };
    }
  });
}
