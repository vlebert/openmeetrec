/**
 * Schéma de configuration, valeurs par défaut et normalisation. Module PUR :
 * la lecture/écriture `chrome.storage.local` vit dans `storage/`.
 */

import type { Config, ProviderId } from '@/shared/types';
import { DEFAULT_MEETING_PATTERNS, normalizeMeetingPatterns } from '@/meetings/patterns';
import { getProviderPreset, PROVIDER_PRESETS } from '@/providers/registry';

export const DEFAULT_CONFIG: Config = {
  provider: 'mistral',
  model: 'voxtral-mini-latest',
  apiKeys: {},
  diarize: true,
  downloadAudio: false,
  language: null,
  meetingReminder: true,
  meetingPatterns: [...DEFAULT_MEETING_PATTERNS],
};

const PROVIDER_IDS = PROVIDER_PRESETS.map((p) => p.id);

function isKnownProvider(value: unknown): value is Exclude<ProviderId, 'mock'> {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalise ce qui vient du storage en une config exploitable.
 *
 * Le storage peut contenir n'importe quoi (version antérieure, écriture
 * manuelle), donc rien n'est présumé : chaque champ est validé ou remplacé par
 * son défaut. Un provider inconnu retombe sur le défaut, et un modèle vide
 * retombe sur le premier preset du provider retenu.
 */
export function normalizeConfig(stored: unknown): Config {
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;

  const provider = isKnownProvider(raw['provider']) ? raw['provider'] : DEFAULT_CONFIG.provider;
  const model = asString(raw['model']) ?? defaultModelFor(provider);

  const rawKeys = (
    typeof raw['apiKeys'] === 'object' && raw['apiKeys'] !== null ? raw['apiKeys'] : {}
  ) as Record<string, unknown>;
  const apiKeys: Config['apiKeys'] = {};
  for (const id of PROVIDER_IDS) {
    const key = asString(rawKeys[id]);
    if (key !== undefined) apiKeys[id] = key;
  }

  const config: Config = {
    provider,
    model,
    apiKeys,
    diarize: asBoolean(raw['diarize'], DEFAULT_CONFIG.diarize),
    downloadAudio: asBoolean(raw['downloadAudio'], DEFAULT_CONFIG.downloadAudio),
    language: asString(raw['language']) ?? null,
    meetingReminder: asBoolean(raw['meetingReminder'], DEFAULT_CONFIG.meetingReminder),
    // Une liste présente fait foi, même vide : c'est l'utilisateur qui a tout
    // retiré. Les défauts ne servent qu'à amorcer une config qui n'en a pas.
    meetingPatterns: Array.isArray(raw['meetingPatterns'])
      ? normalizeMeetingPatterns(raw['meetingPatterns'])
      : [...DEFAULT_MEETING_PATTERNS],
  };

  const customEndpoint = asString(raw['customEndpoint']);
  if (customEndpoint !== undefined) config.customEndpoint = customEndpoint;
  if (typeof raw['customSupportsSegments'] === 'boolean') {
    config.customSupportsSegments = raw['customSupportsSegments'];
  }
  if (typeof raw['customSupportsDiarization'] === 'boolean') {
    config.customSupportsDiarization = raw['customSupportsDiarization'];
  }

  return config;
}

/** Premier modèle preset d'un provider, ou chaîne vide pour `custom`. */
export function defaultModelFor(provider: Exclude<ProviderId, 'mock'>): string {
  return getProviderPreset(provider).models[0]?.id ?? '';
}

export type ConfigProblem =
  | { field: 'apiKey'; message: string }
  | { field: 'model'; message: string }
  | { field: 'customEndpoint'; message: string };

/**
 * Liste ce qui empêche de lancer un enregistrement. Renvoie un tableau vide si
 * la config est utilisable.
 */
export function validateConfig(config: Config): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  if (!config.apiKeys[config.provider]) {
    problems.push({ field: 'apiKey', message: `Missing API key for ${config.provider}.` });
  }
  if (!config.model) {
    problems.push({ field: 'model', message: 'No model selected.' });
  }
  if (config.provider === 'custom') {
    const endpoint = config.customEndpoint ?? '';
    if (!endpoint) {
      problems.push({ field: 'customEndpoint', message: 'Custom endpoint required.' });
    } else if (!/^https:\/\//.test(endpoint)) {
      problems.push({ field: 'customEndpoint', message: 'Custom endpoint: HTTPS required.' });
    }
  }

  return problems;
}

/** Masque une clé API pour l'affichage. Jamais la valeur brute dans l'UI ou les logs. */
export function maskApiKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 3)}${'•'.repeat(Math.min(12, key.length - 6))}${key.slice(-3)}`;
}
