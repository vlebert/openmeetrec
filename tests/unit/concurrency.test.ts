import { describe, expect, it } from 'vitest';
import { mapLimit, mapLimitSettled } from '@/pipeline/concurrency';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('mapLimit', () => {
  it('préserve l ordre des résultats', async () => {
    const items = [50, 10, 30, 5];
    const result = await mapLimit(items, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms / 10));
      return ms;
    });
    expect(result).toEqual(items);
  });

  it('ne dépasse jamais la concurrence demandée', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return i;
    });
    expect(peak).toBe(3);
  });

  it('n ouvre pas plus de workers que d éléments', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapLimit([1, 2], 10, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return i;
    });
    expect(peak).toBe(2);
  });

  it('renvoie une liste vide sans élément', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it('rejette une limite invalide', async () => {
    await expect(mapLimit([1], 0, async () => 1)).rejects.toThrow(RangeError);
  });

  it('propage la première erreur et arrête de démarrer des tâches', async () => {
    const started: number[] = [];
    const promise = mapLimit(Array.from({ length: 10 }, (_, i) => i), 2, async (i) => {
      started.push(i);
      await tick();
      if (i === 1) throw new Error('boom');
      return i;
    });
    await expect(promise).rejects.toThrow('boom');
    expect(started.length).toBeLessThan(10);
  });
});

describe('mapLimitSettled', () => {
  it('isole les échecs sans perdre les succès', async () => {
    const results = await mapLimitSettled([0, 1, 2], 2, async (i) => {
      if (i === 1) throw new Error('chunk 1 KO');
      return i * 10;
    });
    expect(results[0]).toEqual({ status: 'ok', value: 0 });
    expect(results[2]).toEqual({ status: 'ok', value: 20 });
    expect(results[1]!.status).toBe('failed');
  });
});
