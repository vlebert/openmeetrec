import { describe, expect, it } from 'vitest';
import {
  adjustTimestamps,
  chunkBoundaries,
  countSpeakers,
  groupSegmentsBySpeaker,
  mergeSegments,
  mergeTexts,
  segmentsToText,
} from '@/audio/merge';
import type { ChunkInfo, Segment } from '@/shared/types';

const seg = (text: string, start: number, end: number, speakerId?: string): Segment =>
  speakerId === undefined ? { text, start, end } : { text, start, end, speakerId };

describe('adjustTimestamps', () => {
  it('laisse le premier chunk intact', () => {
    const chunk: ChunkInfo = { index: 0, start: 0, end: 300 };
    expect(adjustTimestamps(chunk, [seg('a', 10, 20)])).toEqual([seg('a', 10, 20)]);
  });

  it('décale les timestamps par l offset du chunk', () => {
    const chunk: ChunkInfo = { index: 1, start: 270, end: 570 };
    expect(adjustTimestamps(chunk, [seg('a', 10, 20, '1')])).toEqual([seg('a', 280, 290, '1')]);
  });

  it('ne mute pas les segments d entrée', () => {
    const chunk: ChunkInfo = { index: 1, start: 270, end: 570 };
    const input = [seg('a', 10, 20)];
    adjustTimestamps(chunk, input);
    expect(input[0]!.start).toBe(10);
  });
});

describe('mergeSegments', () => {
  it('renvoie une liste vide sans chunk', () => {
    expect(mergeSegments([], [])).toEqual([]);
  });

  it('refuse des longueurs incohérentes', () => {
    expect(() => mergeSegments([{ index: 0, start: 0, end: 10 }], [])).toThrow();
  });

  it('sur un chunk unique, se contente d ajuster', () => {
    const chunks: ChunkInfo[] = [{ index: 0, start: 0, end: 100 }];
    expect(mergeSegments(chunks, [[seg('a', 0, 5)]])).toEqual([seg('a', 0, 5)]);
  });

  it('coupe au milieu du recouvrement et supprime les doublons', () => {
    const chunks: ChunkInfo[] = [
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
    ];
    // Milieu de l'overlap = 285 s.
    const first = [seg('avant', 100, 110), seg('doublon', 275, 280)];
    // Chunk 1 : timestamps relatifs → 275 s absolu = 5 s relatif.
    const second = [seg('doublon', 5, 10), seg('après', 30, 40)];

    const merged = mergeSegments(chunks, [first, second]);

    expect(merged.map((s) => s.text)).toEqual(['avant', 'doublon', 'après']);
    expect(merged.map((s) => s.start)).toEqual([100, 275, 300]);
  });

  it('borne un chunk du milieu par les deux mi-recouvrements', () => {
    const chunks: ChunkInfo[] = [
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
      { index: 2, start: 540, end: 700 },
    ];
    const merged = mergeSegments(chunks, [
      [seg('c0', 290, 295)], // 290 > 285 → écarté au profit du chunk 1
      [seg('c1a', 20, 25), seg('c1b', 290, 295)], // 290 → 560 absolu > 555 → écarté
      [seg('c2', 20, 25)], // 560 absolu → conservé
    ]);

    expect(merged.map((s) => s.text)).toEqual(['c1a', 'c2']);
    expect(merged.map((s) => s.start)).toEqual([290, 560]);
  });

  it('trie le résultat par timestamp', () => {
    const chunks: ChunkInfo[] = [
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
    ];
    const merged = mergeSegments(chunks, [
      [seg('b', 200, 210), seg('a', 10, 20)],
      [seg('c', 100, 110)],
    ]);
    expect(merged.map((s) => s.start)).toEqual([10, 200, 370]);
  });

  it('préserve les speakerId', () => {
    const chunks: ChunkInfo[] = [{ index: 0, start: 0, end: 100 }];
    expect(mergeSegments(chunks, [[seg('a', 0, 5, '2')]])[0]!.speakerId).toBe('2');
  });

  it('tolère un chunk sans segment', () => {
    const chunks: ChunkInfo[] = [
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 400 },
    ];
    expect(mergeSegments(chunks, [[seg('a', 10, 20)], []])).toEqual([seg('a', 10, 20)]);
  });
});

describe('mergeTexts', () => {
  it('concatène en sautant les textes vides', () => {
    const chunks: ChunkInfo[] = [
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
      { index: 2, start: 540, end: 700 },
    ];
    expect(mergeTexts(chunks, ['un ', '  ', ' deux'])).toBe('un\n\ndeux');
  });

  it('refuse des longueurs incohérentes', () => {
    expect(() => mergeTexts([{ index: 0, start: 0, end: 1 }], ['a', 'b'])).toThrow();
  });
});

describe('segmentsToText / countSpeakers', () => {
  it('recompose un texte continu', () => {
    expect(segmentsToText([seg(' a ', 0, 1), seg('', 1, 2), seg('b', 2, 3)])).toBe('a b');
  });

  it('compte les speakers distincts', () => {
    expect(countSpeakers([seg('a', 0, 1, '0'), seg('b', 1, 2, '1'), seg('c', 2, 3, '0')])).toBe(2);
    expect(countSpeakers([seg('a', 0, 1)])).toBe(0);
  });
});

describe('groupSegmentsBySpeaker', () => {
  it('fusionne les segments consécutifs du même speaker en un tour de parole', () => {
    const turns = groupSegmentsBySpeaker([
      seg('Bonjour,', 0, 2, '0'),
      seg('comment ça va ?', 2, 4, '0'),
      seg('Bien merci.', 4, 6, '1'),
    ]);

    expect(turns).toEqual([
      { speakerId: '0', start: 0, end: 4, text: 'Bonjour, comment ça va ?' },
      { speakerId: '1', start: 4, end: 6, text: 'Bien merci.' },
    ]);
  });

  it('ne fusionne pas deux segments du même speaker à travers une frontière de chunk', () => {
    // Speaker '0' de part et d'autre de la frontière à 100s : identifiants non
    // appariés entre chunks, donc pas la même personne malgré l'ID identique.
    const turns = groupSegmentsBySpeaker(
      [seg('Avant.', 0, 5, '0'), seg('Après.', 120, 125, '0')],
      [100],
    );

    expect(turns).toEqual([
      { speakerId: '0', start: 0, end: 5, text: 'Avant.' },
      { speakerId: '0', start: 120, end: 125, text: 'Après.' },
    ]);
  });

  it('recommence un tour si un speaker revient après un autre', () => {
    const turns = groupSegmentsBySpeaker([
      seg('a', 0, 1, '0'),
      seg('b', 1, 2, '1'),
      seg('c', 2, 3, '0'),
    ]);
    expect(turns.map((t) => t.speakerId)).toEqual(['0', '1', '0']);
  });

  it('ignore les textes vides sans casser la fusion', () => {
    const turns = groupSegmentsBySpeaker([
      seg('a', 0, 1, '0'),
      seg('', 1, 2, '0'),
      seg('b', 2, 3, '0'),
    ]);
    expect(turns).toEqual([{ speakerId: '0', start: 0, end: 3, text: 'a b' }]);
  });

  it('renvoie une liste vide sans segment', () => {
    expect(groupSegmentsBySpeaker([])).toEqual([]);
  });
});

describe('chunkBoundaries', () => {
  it('renvoie une liste vide sous deux chunks', () => {
    expect(chunkBoundaries([])).toEqual([]);
    expect(chunkBoundaries([{ index: 0, start: 0, end: 300 }])).toEqual([]);
  });

  it('place une borne au milieu de chaque recouvrement', () => {
    const chunks: ChunkInfo[] = [
      { index: 0, start: 0, end: 300 },
      { index: 1, start: 270, end: 570 },
      { index: 2, start: 540, end: 700 },
    ];
    // Milieux des recouvrements : (300+270)/2 = 285, (570+540)/2 = 555.
    expect(chunkBoundaries(chunks)).toEqual([285, 555]);
  });
});
