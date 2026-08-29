/**
 * Lecture/écriture de la configuration dans `chrome.storage.local`.
 *
 * `local` et pas `sync` : la config contient les clés API, et `sync` les
 * répliquerait sur tous les appareils du compte Google (docs/permissions-audit.md).
 *
 * Appelable seulement depuis un contexte qui a `chrome.storage` : service
 * worker, popup, page d'options. **Pas** depuis l'offscreen document, qui n'a
 * accès qu'à `chrome.runtime` (architecture §3.6).
 */

import { normalizeConfig } from '@/config/config';
import type { Config } from '@/shared/types';

const CONFIG_KEY = 'config';

export async function loadConfig(): Promise<Config> {
  // Pas de try/catch : `normalizeConfig` absorbe déjà les données douteuses, et
  // une erreur de l'API storage doit remonter au lieu d'être maquillée en config
  // par défaut — c'est exactement ce qui avait masqué l'absence de
  // `chrome.storage` dans l'offscreen document.
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return normalizeConfig(stored[CONFIG_KEY]);
}

export async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}
