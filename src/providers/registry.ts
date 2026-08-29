/**
 * Presets de providers et de modèles, et résolution des capacités. Module PUR.
 *
 * Seuls les modèles renvoyant des segments horodatés sont proposés en preset :
 * c'est ce qui permet un merge sans doublons entre chunks (PRD §8, F-TR-04).
 */

import type { Config, ProviderId } from '@/shared/types';

export interface ModelPreset {
  id: string;
  label: string;
  supportsSegments: boolean;
}

export interface ProviderPreset {
  id: Exclude<ProviderId, 'mock'>;
  label: string;
  /** Vide pour `custom` : l'endpoint vient de la config. */
  endpoint: string;
  models: ModelPreset[];
  supportsDiarization: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'mistral',
    label: 'Mistral (Voxtral)',
    endpoint: 'https://api.mistral.ai/v1/audio/transcriptions',
    models: [{ id: 'voxtral-mini-latest', label: 'Voxtral Mini', supportsSegments: true }],
    supportsDiarization: true,
  },
  {
    id: 'openai',
    label: 'OpenAI (Whisper)',
    endpoint: 'https://api.openai.com/v1/audio/transcriptions',
    models: [{ id: 'whisper-1', label: 'Whisper v1', supportsSegments: true }],
    supportsDiarization: false,
  },
  {
    id: 'custom',
    label: 'Custom (free endpoint)',
    endpoint: '',
    models: [],
    supportsDiarization: false,
  },
];

export function getProviderPreset(id: Exclude<ProviderId, 'mock'>): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown provider: ${id}`);
  return preset;
}

export function getModelPreset(
  providerId: Exclude<ProviderId, 'mock'>,
  modelId: string,
): ModelPreset | undefined {
  return getProviderPreset(providerId).models.find((m) => m.id === modelId);
}

export interface ResolvedCapabilities {
  endpoint: string;
  /** Le provider/modèle retenu renvoie-t-il des segments horodatés ? */
  supportsSegments: boolean;
  /** Le provider peut-il faire de la diarization ? */
  supportsDiarization: boolean;
  /** Diarization effectivement demandée : option activée ET supportée. */
  diarize: boolean;
}

/**
 * Résout ce dont le pipeline a besoin à partir de la config utilisateur.
 *
 * Un modèle saisi à la main (hors preset) est considéré comme sans segments :
 * on préfère avertir à tort que produire un markdown avec des doublons
 * silencieux.
 */
export function resolveCapabilities(config: Config): ResolvedCapabilities {
  const preset = getProviderPreset(config.provider);

  if (config.provider === 'custom') {
    return {
      endpoint: config.customEndpoint ?? '',
      supportsSegments: config.customSupportsSegments ?? false,
      supportsDiarization: config.customSupportsDiarization ?? false,
      diarize: config.diarize && (config.customSupportsDiarization ?? false),
    };
  }

  const model = getModelPreset(config.provider, config.model);
  return {
    endpoint: preset.endpoint,
    supportsSegments: model?.supportsSegments ?? false,
    supportsDiarization: preset.supportsDiarization,
    diarize: config.diarize && preset.supportsDiarization,
  };
}
