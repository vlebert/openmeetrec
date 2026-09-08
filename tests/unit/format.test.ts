import { describe, expect, it } from 'vitest';
import {
  buildBody,
  buildFilename,
  buildFrontmatter,
  buildMarkdown,
  buildWarnings,
  formatSpeaker,
  formatTimestamp,
} from '@/shared/format';
import type { TranscriptDocument } from '@/shared/format';
import type { SessionMeta } from '@/shared/types';

const META: SessionMeta = {
  provider: 'mistral',
  model: 'voxtral-mini-latest',
  date: '2026-04-13T12:34:56Z',
  duration: 1842.4,
  platform: 'meet.google.com',
  extensionVersion: '0.1.0',
};

const doc = (overrides: Partial<TranscriptDocument> = {}): TranscriptDocument => ({
  meta: META,
  diarized: false,
  chunkCount: 1,
  hadSegments: true,
  ...overrides,
});

describe('formatTimestamp', () => {
  it('formate en HH:MM:SS', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(12)).toBe('00:00:12');
    expect(formatTimestamp(754)).toBe('00:12:34');
    expect(formatTimestamp(3661)).toBe('01:01:01');
  });

  it('tronque les fractions et borne à zéro', () => {
    expect(formatTimestamp(12.9)).toBe('00:00:12');
    expect(formatTimestamp(-5)).toBe('00:00:00');
  });
});

describe('formatSpeaker', () => {
  it('préfixe un identifiant numérique', () => {
    expect(formatSpeaker('0')).toBe('Speaker 0');
  });

  it('normalise les formes des providers', () => {
    // Voxtral renvoie `speaker_1`, constaté sur une vraie réponse d'API.
    expect(formatSpeaker('speaker_1')).toBe('Speaker 1');
    expect(formatSpeaker('SPEAKER_00')).toBe('Speaker 0');
    expect(formatSpeaker('speaker 2')).toBe('Speaker 2');
    expect(formatSpeaker('speaker-3')).toBe('Speaker 3');
  });

  it('laisse un libellé déjà lisible', () => {
    expect(formatSpeaker('Alice')).toBe('Alice');
    expect(formatSpeaker('speaker inconnu')).toBe('speaker inconnu');
  });

  it('gère l absence d identifiant', () => {
    expect(formatSpeaker(undefined)).toBe('Speaker ?');
  });
});

describe('buildFrontmatter', () => {
  it('contient les champs requis par le PRD', () => {
    const fm = buildFrontmatter(doc());
    expect(fm).toContain('model: voxtral-mini-latest');
    expect(fm).toContain('provider: mistral');
    expect(fm).toContain('platform: meet.google.com');
    expect(fm).toContain('extension_version: 0.1.0');
  });

  it('arrondit la durée en secondes', () => {
    expect(buildFrontmatter(doc())).toContain('duration: 1842');
  });

  it('n annonce des speakers qu en diarization', () => {
    expect(buildFrontmatter(doc())).not.toContain('speakers:');
    const diarized = doc({
      diarized: true,
      segments: [
        { text: 'a', start: 0, end: 1, speakerId: '0' },
        { text: 'b', start: 1, end: 2, speakerId: '1' },
      ],
    });
    expect(buildFrontmatter(diarized)).toContain('speakers: 2');
  });

  it('ne compte pas les speakers quand la transcription vient de plusieurs chunks', () => {
    const chunked = doc({
      diarized: true,
      chunkBoundaries: [100],
      segments: [
        { text: 'a', start: 0, end: 1, speakerId: '0' },
        { text: 'b', start: 120, end: 121, speakerId: '0' },
      ],
    });
    expect(buildFrontmatter(chunked)).not.toContain('speakers:');
  });

  it('cite une valeur contenant des caractères YAML', () => {
    const fm = buildFrontmatter(doc({ meta: { ...META, platform: 'host: weird' } }));
    expect(fm).toContain('platform: "host: weird"');
  });
});

describe('buildBody', () => {
  it('rend le texte brut sans diarization', () => {
    const body = buildBody(doc({ text: 'Bonjour tout le monde.' }));
    expect(body).toBe('Bonjour tout le monde.');
  });

  it('rend un paragraphe par tour de parole avec diarization', () => {
    const body = buildBody(
      doc({
        diarized: true,
        segments: [
          { text: 'Bonjour.', start: 12, end: 15, speakerId: '0' },
          { text: 'Salut.', start: 45, end: 47, speakerId: '1' },
        ],
      }),
    );
    expect(body).toBe(['**Speaker 0** (00:00:12): Bonjour.', '', '**Speaker 1** (00:00:45): Salut.'].join('\n'));
  });

  it('fusionne les segments consécutifs du même speaker en un seul paragraphe', () => {
    const body = buildBody(
      doc({
        diarized: true,
        segments: [
          { text: 'Bonjour,', start: 12, end: 13, speakerId: '0' },
          { text: 'comment ça va ?', start: 13, end: 15, speakerId: '0' },
          { text: 'Bien merci.', start: 15, end: 17, speakerId: '1' },
        ],
      }),
    );
    expect(body).toBe(
      ['**Speaker 0** (00:00:12): Bonjour, comment ça va ?', '', '**Speaker 1** (00:00:15): Bien merci.'].join('\n'),
    );
  });

  it('recompose le texte depuis les segments quand la diarization est off', () => {
    const body = buildBody(
      doc({
        segments: [
          { text: 'Un.', start: 0, end: 1 },
          { text: 'Deux.', start: 1, end: 2 },
        ],
      }),
    );
    expect(body).toBe('Un. Deux.');
  });

  it('masque les speakers et sépare les chunks par une règle quand il y a des bornes', () => {
    const body = buildBody(
      doc({
        diarized: true,
        chunkBoundaries: [100],
        segments: [
          { text: 'Avant.', start: 0, end: 5, speakerId: '0' },
          { text: 'Après.', start: 120, end: 125, speakerId: '0' },
        ],
      }),
    );
    expect(body).toBe(['(00:00:00) Avant.', '', '---', '', '(00:02:00) Après.'].join('\n'));
    expect(body).not.toContain('Speaker');
    expect(body).not.toContain('Chunk');
  });

  it('garde un saut de paragraphe à chaque changement de speaker dans un chunk', () => {
    const body = buildBody(
      doc({
        diarized: true,
        chunkBoundaries: [1000],
        segments: [
          { text: 'Bonjour,', start: 12, end: 13, speakerId: '0' },
          { text: 'ça va ?', start: 13, end: 15, speakerId: '0' },
          { text: 'Bien merci.', start: 15, end: 17, speakerId: '1' },
        ],
      }),
    );
    expect(body).toBe(['(00:00:12) Bonjour, ça va ?', '', '(00:00:15) Bien merci.'].join('\n'));
  });

  it('ne pose qu une règle même si un chunk entier n a produit aucun tour', () => {
    const body = buildBody(
      doc({
        diarized: true,
        chunkBoundaries: [100, 200],
        segments: [
          { text: 'Avant.', start: 0, end: 5, speakerId: '0' },
          { text: 'Après.', start: 250, end: 255, speakerId: '0' },
        ],
      }),
    );
    expect(body.match(/^---$/gm)).toHaveLength(1);
  });

  it('ne commence jamais le corps par une règle', () => {
    const body = buildBody(
      doc({
        diarized: true,
        chunkBoundaries: [100],
        segments: [{ text: 'Après.', start: 120, end: 125, speakerId: '0' }],
      }),
    );
    expect(body).toBe('(00:02:00) Après.');
  });

  it('ne montre aucune section sans bornes de chunk', () => {
    const body = buildBody(
      doc({
        diarized: true,
        segments: [{ text: 'Bonjour.', start: 0, end: 1, speakerId: '0' }],
      }),
    );
    expect(body).not.toContain('Chunk');
  });
});

describe('buildWarnings', () => {
  it('ne prévient de rien sur un cas nominal', () => {
    expect(buildWarnings(doc({ hadSegments: true, chunkCount: 3 }))).toEqual([]);
  });

  it('prévient des doublons quand il n y a pas de timestamps', () => {
    const warnings = buildWarnings(doc({ hadSegments: false, chunkCount: 3 }));
    expect(warnings.join(' ')).toContain('duplicat');
  });

  it('ne prévient pas des doublons sur un chunk unique', () => {
    expect(buildWarnings(doc({ hadSegments: false, chunkCount: 1 }))).toEqual([]);
  });

  it('explique pourquoi les speakers ne sont pas nommés en transcription par chunks', () => {
    const warnings = buildWarnings(doc({ diarized: true, chunkCount: 2, chunkBoundaries: [100] }));
    expect(warnings.join(' ')).toContain('Speakers are not named');
  });

  it('ne dit rien des speakers quand la transcription tient en une requête', () => {
    expect(buildWarnings(doc({ diarized: true, chunkCount: 1 }))).toEqual([]);
  });

  it('signale les chunks en échec', () => {
    const warnings = buildWarnings(doc({ failedChunks: [2, 5] }));
    expect(warnings.join(' ')).toContain('2, 5');
  });
});

describe('buildMarkdown', () => {
  it('assemble frontmatter puis corps', () => {
    const md = buildMarkdown(doc({ text: 'Bonjour.' }));
    expect(md.startsWith('---\n')).toBe(true);
    expect(md.trimEnd().endsWith('Bonjour.')).toBe(true);
    expect(md.endsWith('\n')).toBe(true);
  });

  it('insère les notes entre le frontmatter et la transcription', () => {
    const md = buildMarkdown(doc({ text: 'Bonjour.', hadSegments: false, chunkCount: 2 }));
    expect(md.indexOf('**Notes**')).toBeGreaterThan(md.indexOf('---'));
    expect(md.indexOf('**Notes**')).toBeLessThan(md.indexOf('Bonjour.'));
  });
});

describe('buildFilename', () => {
  it('produit un nom sans caractère problématique', () => {
    expect(buildFilename(META, 'md')).toBe('openmeetrec_meet.google.com_2026-04-13T12-34-56Z.md');
  });

  it('nettoie une plateforme exotique', () => {
    const name = buildFilename({ ...META, platform: 'a/b c' }, 'webm');
    expect(name).toContain('a_b_c');
    expect(name.endsWith('.webm')).toBe(true);
  });
});
