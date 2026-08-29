import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/providers/base';
import { computeBackoffMs, isRetryableStatus, withRetry } from '@/providers/retry';

const noSleep = () => Promise.resolve();

describe('isRetryableStatus', () => {
  it('retente le rate limit et les erreurs serveur', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('abandonne sur une clé invalide', () => {
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('retente quand il n y a pas de statut (réseau, timeout)', () => {
    expect(isRetryableStatus(undefined)).toBe(true);
  });
});

describe('computeBackoffMs', () => {
  const opts = { baseDelayMs: 1000, maxDelayMs: 30_000 };

  it('croît exponentiellement', () => {
    expect(computeBackoffMs(1, opts, 1)).toBe(1000);
    expect(computeBackoffMs(2, opts, 1)).toBe(2000);
    expect(computeBackoffMs(3, opts, 1)).toBe(4000);
  });

  it('applique un jitter borné à la moitié basse', () => {
    expect(computeBackoffMs(1, opts, 0)).toBe(500);
    expect(computeBackoffMs(1, opts, 0.5)).toBe(750);
  });

  it('plafonne le délai', () => {
    expect(computeBackoffMs(20, opts, 1)).toBe(30_000);
  });
});

describe('withRetry', () => {
  it('renvoie le résultat sans retry si tout va bien', async () => {
    const fn = vi.fn(async () => 'ok');
    expect(await withRetry(fn, { sleep: noSleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retente une erreur transitoire puis réussit', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new ProviderError('mistral', 'rate limited', 429);
        return 'ok';
      },
      { sleep: noSleep, random: () => 0.5 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('abandonne immédiatement sur une clé invalide', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('openai', 'unauthorized', 401);
    });
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respecte le plafond de tentatives', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('mistral', 'boom', 500);
    });
    await expect(withRetry(fn, { maxAttempts: 3, sleep: noSleep, random: () => 0 })).rejects.toThrow(
      'boom',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('attend entre les tentatives', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new ProviderError('mistral', 'boom', 500);
        return 'ok';
      },
      { sleep, random: () => 1 },
    );
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
