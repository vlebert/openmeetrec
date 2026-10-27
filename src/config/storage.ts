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

const MIC_DEVICE_KEY = 'micDeviceId';

/**
 * Micro choisi dans le popup, `null` = défaut système. Hors de `Config` : c'est
 * un réglage du poste, pas de la transcription, et un `deviceId` n'a de sens
 * que pour cette installation de l'extension.
 */
export async function loadMicDevice(): Promise<string | null> {
  const stored = await chrome.storage.local.get(MIC_DEVICE_KEY);
  const value: unknown = stored[MIC_DEVICE_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function saveMicDevice(deviceId: string | null): Promise<void> {
  if (deviceId === null) await chrome.storage.local.remove(MIC_DEVICE_KEY);
  else await chrome.storage.local.set({ [MIC_DEVICE_KEY]: deviceId });
}
