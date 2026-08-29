import { describe, expect, it } from 'vitest';

import { parseTranscription } from '@/providers/parse';

describe('parseTranscription', () => {
  it('lit la forme Mistral, speaker_id compris', () => {
    const result = parseTranscription({
      text: 'bonjour tout le monde',
      segments: [
        { text: 'bonjour', start: 0, end: 1.5, speaker_id: 0 },
        { text: 'tout le monde', start: 1.5, end: 3, speaker_id: 1 },
      ],
    });

    expect(result.text).toBe('bonjour tout le monde');
    expect(result.segments).toEqual([
      { text: 'bonjour', start: 0, end: 1.5, speakerId: '0' },
      { text: 'tout le monde', start: 1.5, end: 3, speakerId: '1' },
    ]);
  });

  it('lit la forme OpenAI verbose_json, sans locuteur', () => {
    const result = parseTranscription({
      text: 'salut',
      segments: [{ id: 0, seek: 0, start: 0, end: 2, text: ' salut ' }],
    });

    expect(result.segments).toEqual([{ text: 'salut', start: 0, end: 2 }]);
  });

  it('reconstruit le texte quand la réponse ne le donne pas', () => {
    const result = parseTranscription({
      segments: [
        { text: 'un', start: 0, end: 1 },
        { text: 'deux', start: 1, end: 2 },
      ],
    });

    expect(result.text).toBe('un deux');
  });

  // Une réponse réseau peut contenir n'importe quoi : mieux vaut perdre un
  // segment douteux que produire des timestamps NaN dans le markdown final.
  it('écarte les segments inexploitables sans jeter le reste', () => {
    const result = parseTranscription({
      text: 'ok',
      segments: [
        { text: '', start: 0, end: 1 },
        { text: 'valide', start: '2.5', end: 4 },
        { text: 'sans bornes' },
        null,
      ],
    });

    expect(result.segments).toEqual([{ text: 'valide', start: 2.5, end: 4 }]);
  });

  it('renvoie un résultat sans segments quand il n’y en a pas', () => {
    expect(parseTranscription({ text: 'brut' })).toEqual({ text: 'brut' });
  });

  it('refuse une réponse qui n’est pas un objet', () => {
    expect(() => parseTranscription('nope')).toThrow(/illisible/);
  });
});
