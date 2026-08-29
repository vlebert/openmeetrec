import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  defaultModelFor,
  maskApiKey,
  normalizeConfig,
  validateConfig,
} from '@/config/config';
import type { Config } from '@/shared/types';

const withDefaults = (overrides: Partial<Config> = {}): Config => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

describe('normalizeConfig', () => {
  it('renvoie les défauts pour un storage vide', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('ignore un provider inconnu', () => {
    expect(normalizeConfig({ provider: 'acme' }).provider).toBe(DEFAULT_CONFIG.provider);
  });

  it('retombe sur le modèle par défaut du provider', () => {
    expect(normalizeConfig({ provider: 'openai' }).model).toBe('whisper-1');
  });

  it('conserve un modèle custom', () => {
    expect(normalizeConfig({ provider: 'openai', model: 'gpt-4o-transcribe' }).model).toBe(
      'gpt-4o-transcribe',
    );
  });

  it('ne garde que les clés API des providers connus', () => {
    const config = normalizeConfig({
      apiKeys: { mistral: 'sk-a', acme: 'sk-b', openai: '   ' },
    });
    expect(config.apiKeys).toEqual({ mistral: 'sk-a' });
  });

  it('traite une langue vide comme automatique', () => {
    expect(normalizeConfig({ language: '  ' }).language).toBeNull();
    expect(normalizeConfig({ language: 'fr' }).language).toBe('fr');
  });

  it('ignore des types incorrects sur les booléens', () => {
    const config = normalizeConfig({ diarize: 'oui', downloadAudio: 1 });
    expect(config.diarize).toBe(DEFAULT_CONFIG.diarize);
    expect(config.downloadAudio).toBe(DEFAULT_CONFIG.downloadAudio);
  });

  it('conserve les réglages du provider custom', () => {
    const config = normalizeConfig({
      provider: 'custom',
      model: 'local-whisper',
      customEndpoint: 'https://example.test/v1/transcribe',
      customSupportsSegments: true,
    });
    expect(config.customEndpoint).toBe('https://example.test/v1/transcribe');
    expect(config.customSupportsSegments).toBe(true);
    expect(config.customSupportsDiarization).toBeUndefined();
  });
});

describe('defaultModelFor', () => {
  it('donne le premier preset du provider', () => {
    expect(defaultModelFor('mistral')).toBe('voxtral-mini-latest');
    expect(defaultModelFor('openai')).toBe('whisper-1');
  });

  it('renvoie une chaîne vide pour custom, qui n a pas de preset', () => {
    expect(defaultModelFor('custom')).toBe('');
  });
});

describe('validateConfig', () => {
  it('accepte une config complète', () => {
    expect(validateConfig(withDefaults({ apiKeys: { mistral: 'sk-x' } }))).toEqual([]);
  });

  it('signale une clé API manquante', () => {
    const problems = validateConfig(withDefaults());
    expect(problems.map((p) => p.field)).toContain('apiKey');
  });

  it('signale un modèle vide', () => {
    const problems = validateConfig(withDefaults({ apiKeys: { mistral: 'sk-x' }, model: '' }));
    expect(problems.map((p) => p.field)).toContain('model');
  });

  it('exige un endpoint HTTPS pour le provider custom', () => {
    const base = withDefaults({
      provider: 'custom',
      model: 'x',
      apiKeys: { custom: 'sk-x' },
    });
    expect(validateConfig(base).map((p) => p.field)).toContain('customEndpoint');
    expect(
      validateConfig({ ...base, customEndpoint: 'http://example.test' }).map((p) => p.field),
    ).toContain('customEndpoint');
    expect(validateConfig({ ...base, customEndpoint: 'https://example.test' })).toEqual([]);
  });
});

describe('maskApiKey', () => {
  it('ne laisse jamais filtrer la clé complète', () => {
    const key = 'sk-abcdefghijklmnop';
    const masked = maskApiKey(key);
    expect(masked).not.toContain('abcdefghij');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.endsWith('nop')).toBe(true);
  });

  it('masque intégralement une clé courte', () => {
    expect(maskApiKey('short')).toBe('•••••');
  });

  it('gère l absence de clé', () => {
    expect(maskApiKey(undefined)).toBe('');
  });
});
