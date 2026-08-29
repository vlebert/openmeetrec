/**
 * Backoff exponentiel pour les appels providers. Module PUR : l'attente et
 * l'aléa sont injectés, ce qui rend la politique testable sans timers réels.
 */

import { ProviderError } from './base';

export interface RetryOptions {
  /** Nombre total de tentatives, première incluse. */
  maxAttempts: number;
  /** Délai de base en ms, doublé à chaque tentative. */
  baseDelayMs: number;
  /** Plafond du délai en ms. */
  maxDelayMs: number;
  /** Injectable pour les tests. */
  sleep: (ms: number) => Promise<void>;
  /** Injectable pour les tests. */
  random: () => number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/**
 * Un statut vaut-il la peine d'être retenté ?
 *
 * 429 (rate limit) et 5xx sont transitoires. 401/403 signifient une clé
 * invalide : réessayer ne ferait que brûler du quota, on abandonne tout de suite.
 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // erreur réseau / timeout
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderError) return isRetryableStatus(error.status);
  return error instanceof Error;
}

/** Délai avant la tentative suivante, avec jitter pour désynchroniser les chunks. */
export function computeBackoffMs(
  attempt: number,
  opts: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs'>,
  randomValue: number,
): number {
  const exponential = opts.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, opts.maxDelayMs);
  // Jitter « full » : uniforme sur [capped/2, capped].
  return Math.round(capped * (0.5 + 0.5 * randomValue));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1) {
    throw new RangeError('maxAttempts doit être un entier >= 1');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === opts.maxAttempts || !isRetryableError(error)) throw error;
      await opts.sleep(computeBackoffMs(attempt, opts, opts.random()));
    }
  }
  throw lastError;
}
