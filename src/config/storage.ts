/**
 * Lecture/écriture de la configuration dans `chrome.storage.local`.
 *
 * `local` et pas `sync` : la config contient les clés API, et `sync` les
 * répliquerait sur tous les appareils du compte Google (docs/permissions-audit.md).
 */

import { DEFAULT_CONFIG, normalizeConfig } from '@/config/config';
import type { Config } from '@/shared/types';

const CONFIG_KEY = 'config';

export async function loadConfig(): Promise<Config> {
  try {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    return normalizeConfig(stored[CONFIG_KEY]);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}
