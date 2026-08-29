import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_OPTIONS,
  chunkStartTime,
  chunkStep,
  expectedChunkCount,
  isChunkNeeded,
  planChunks,
} from '@/audio/chunking';

const OPTS = DEFAULT_CHUNK_OPTIONS; // 300 s / 30 s → step 270 s

describe('chunkStep / chunkStartTime', () => {
  it('déduit le pas de la durée et du recouvrement', () => {
    expect(chunkStep(OPTS)).toBe(270);
  });

  it('place les départs de chunks sur le pas', () => {
    expect(chunkStartTime(0, OPTS)).toBe(0);
    expect(chunkStartTime(1, OPTS)).toBe(270);
    expect(chunkStartTime(3, OPTS)).toBe(810);
  });

  it('rejette un index invalide', () => {
    expect(() => chunkStartTime(-1, OPTS)).toThrow(RangeError);
    expect(() => chunkStartTime(1.5, OPTS)).toThrow(RangeError);
  });
});

describe('planChunks', () => {
  it('ne renvoie rien pour une durée nulle ou négative', () => {
    expect(planChunks(0, OPTS)).toEqual([]);
    expect(planChunks(-5, OPTS)).toEqual([]);
  });

  it('renvoie un chunk unique sous le seuil', () => {
    expect(planChunks(120, OPTS)).toEqual([{ index: 0, start: 0, end: 120 }]);
  });

  it('renvoie un chunk unique exactement au seuil', () => {
    expect(planChunks(300, OPTS)).toEqual([{ index: 0, start: 0, end: 300 }]);
  });

  it('découpe avec recouvrement juste au-dessus du seuil', () => {
    expect(planChunks(301, OPTS)).toEqual([
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 301 },
    ]);
  });

  it('enchaîne les chunks sur un enregistrement long', () => {
    const chunks = planChunks(1000, OPTS);
    expect(chunks).toEqual([
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
      { index: 2, start: 540, end: 840 },
      { index: 3, start: 810, end: 1000 },
    ]);
  });

  it('couvre toute la durée sans trou', () => {
    const chunks = planChunks(3600, OPTS);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(3600);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.start).toBeLessThan(chunks[i - 1]!.end);
    }
  });

  it('respecte le recouvrement demandé entre chunks consécutifs', () => {
    const chunks = planChunks(2000, OPTS);
    for (let i = 1; i < chunks.length - 1; i += 1) {
      expect(chunks[i - 1]!.end - chunks[i]!.start).toBe(OPTS.overlap);
    }
  });

  it('supporte un recouvrement nul', () => {
    expect(planChunks(25, { chunkDuration: 10, overlap: 0 })).toEqual([
      { index: 0, start: 0, end: 10 },
      { index: 1, start: 10, end: 20 },
      { index: 2, start: 20, end: 25 },
    ]);
  });

  it('rejette des options incohérentes', () => {
    expect(() => planChunks(100, { chunkDuration: 0, overlap: 0 })).toThrow(RangeError);
    expect(() => planChunks(100, { chunkDuration: 10, overlap: 10 })).toThrow(RangeError);
    expect(() => planChunks(100, { chunkDuration: 10, overlap: -1 })).toThrow(RangeError);
  });
});

describe('isChunkNeeded', () => {
  it('garde un dernier chunk qui apporte du contenu neuf', () => {
    // Stop à 400 s : le chunk 1 couvre [270, 400], dont 100 s inédites.
    expect(expectedChunkCount(400, OPTS)).toBe(2);
    expect(isChunkNeeded(1, 400, OPTS)).toBe(true);
  });

  it('écarte un dernier chunk entièrement contenu dans le précédent', () => {
    // Stop à 280 s : le recorder décalé a bien démarré à 270 s, mais son chunk
    // [270, 280] est déjà couvert par le chunk 0.
    expect(expectedChunkCount(280, OPTS)).toBe(1);
    expect(isChunkNeeded(1, 280, OPTS)).toBe(false);
  });

  it('écarte le chunk dégénéré au moment exact du seuil', () => {
    expect(isChunkNeeded(1, 300, OPTS)).toBe(false);
    expect(isChunkNeeded(1, 300.5, OPTS)).toBe(true);
  });
});
