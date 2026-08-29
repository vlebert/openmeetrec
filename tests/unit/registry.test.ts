import { describe, expect, it } from 'vitest';
import {
  PROVIDER_PRESETS,
  getModelPreset,
  getProviderPreset,
  resolveCapabilities,
} from '@/providers/registry';
import { DEFAULT_CONFIG } from '@/config/config';
import type { Config } from '@/shared/types';

const config = (overrides: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, ...overrides });

describe('presets', () => {
  it('n expose que des modèles renvoyant des segments', () => {
    for (const preset of PROVIDER_PRESETS) {
      for (const model of preset.models) {
        expect(model.supportsSegments).toBe(true);
      }
    }
  });

  it('ne propose pas gpt-4o-transcribe en preset (pas de verbose_json)', () => {
    const openai = getProviderPreset('openai');
    expect(openai.models.map((m) => m.id)).not.toContain('gpt-4o-transcribe');
  });

  it('réserve la diarization à Mistral', () => {
    expect(getProviderPreset('mistral').supportsDiarization).toBe(true);
    expect(getProviderPreset('openai').supportsDiarization).toBe(false);
  });

  it('rejette un provider inconnu', () => {
    // @ts-expect-error provider hors union, on vérifie le garde-fou à l'exécution
    expect(() => getProviderPreset('acme')).toThrow();
  });

  it('trouve un modèle par identifiant', () => {
    expect(getModelPreset('mistral', 'voxtral-mini-latest')?.label).toBe('Voxtral Mini');
    expect(getModelPreset('mistral', 'inconnu')).toBeUndefined();
  });
});

describe('resolveCapabilities', () => {
  it('active la diarization chez Mistral quand elle est demandée', () => {
    const caps = resolveCapabilities(config({ provider: 'mistral', diarize: true }));
    expect(caps).toMatchObject({ supportsSegments: true, supportsDiarization: true, diarize: true });
    expect(caps.endpoint).toContain('api.mistral.ai');
  });

  it('ignore la demande de diarization chez OpenAI', () => {
    const caps = resolveCapabilities(
      config({ provider: 'openai', model: 'whisper-1', diarize: true }),
    );
    expect(caps.supportsSegments).toBe(true);
    expect(caps.diarize).toBe(false);
  });

  it('considère un modèle hors preset comme sans segments', () => {
    const caps = resolveCapabilities(config({ provider: 'openai', model: 'gpt-4o-transcribe' }));
    expect(caps.supportsSegments).toBe(false);
  });

  it('lit les capacités déclarées pour le provider custom', () => {
    const caps = resolveCapabilities(
      config({
        provider: 'custom',
        model: 'local',
        customEndpoint: 'https://example.test/v1',
        customSupportsSegments: true,
        customSupportsDiarization: true,
        diarize: true,
      }),
    );
    expect(caps).toEqual({
      endpoint: 'https://example.test/v1',
      supportsSegments: true,
      supportsDiarization: true,
      diarize: true,
    });
  });

  it('prend des capacités custom prudentes par défaut', () => {
    const caps = resolveCapabilities(config({ provider: 'custom', model: 'local', diarize: true }));
    expect(caps).toEqual({
      endpoint: '',
      supportsSegments: false,
      supportsDiarization: false,
      diarize: false,
    });
  });
});
