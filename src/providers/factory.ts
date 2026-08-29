/**
 * Construction du provider à partir de la config utilisateur. Module PUR.
 */

import { ProviderError, type TranscriptionProvider } from '@/providers/base';
import { CustomProvider } from '@/providers/custom';
import type { HttpProviderOptions } from '@/providers/http';
import { MistralProvider } from '@/providers/mistral';
import { OpenAiProvider } from '@/providers/openai';
import { resolveCapabilities } from '@/providers/registry';
import type { Config } from '@/shared/types';

export function createProvider(config: Config, fetchImpl?: typeof fetch): TranscriptionProvider {
  const capabilities = resolveCapabilities(config);
  const apiKey = config.apiKeys[config.provider] ?? '';
  if (apiKey === '') throw new ProviderError(config.provider, 'clé API absente');
  if (capabilities.endpoint === '') throw new ProviderError(config.provider, 'endpoint absent');

  const options: HttpProviderOptions = {
    endpoint: capabilities.endpoint,
    apiKey,
    supportsSegments: capabilities.supportsSegments,
    supportsDiarization: capabilities.supportsDiarization,
    ...(fetchImpl ? { fetchImpl } : {}),
  };

  switch (config.provider) {
    case 'mistral':
      return new MistralProvider(options);
    case 'openai':
      return new OpenAiProvider(options);
    case 'custom':
      return new CustomProvider(options);
  }
}
