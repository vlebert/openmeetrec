/**
 * UI — page de réglages (PRD §3).
 *
 * Les clés API ne quittent jamais `chrome.storage.local` : elles ne sont ni
 * journalisées, ni réaffichées en clair une fois enregistrées (seul un masque
 * est montré tant que le champ n'est pas modifié).
 */

import { maskApiKey, validateConfig } from '@/config/config';
import { loadConfig, saveConfig } from '@/config/storage';
import { createProvider } from '@/providers/factory';
import { PROVIDER_PRESETS, getProviderPreset } from '@/providers/registry';
import type { Config, ProviderId } from '@/shared/types';

type Provider = Exclude<ProviderId, 'mock'>;

const el = {
  provider: byId<HTMLSelectElement>('provider'),
  model: byId<HTMLSelectElement>('model'),
  modelCustom: byId<HTMLInputElement>('model-custom'),
  apiKey: byId<HTMLInputElement>('api-key'),
  keyHint: byId<HTMLParagraphElement>('key-hint'),
  testKey: byId<HTMLButtonElement>('test-key'),
  testResult: byId<HTMLElement>('test-result'),
  customFields: byId<HTMLFieldSetElement>('custom-fields'),
  customEndpoint: byId<HTMLInputElement>('custom-endpoint'),
  customSegments: byId<HTMLInputElement>('custom-segments'),
  customDiarization: byId<HTMLInputElement>('custom-diarization'),
  diarize: byId<HTMLInputElement>('diarize'),
  diarizeHint: byId<HTMLParagraphElement>('diarize-hint'),
  downloadAudio: byId<HTMLInputElement>('download-audio'),
  language: byId<HTMLInputElement>('language'),
  save: byId<HTMLButtonElement>('save'),
  status: byId<HTMLElement>('status'),
  problems: byId<HTMLUListElement>('problems'),
};

let config: Config;
/** La clé saisie n'est lue que si l'utilisateur a touché le champ. */
let keyEdited = false;

el.provider.addEventListener('change', () => {
  const provider = el.provider.value as Provider;
  config = { ...config, provider, model: getProviderPreset(provider).models[0]?.id ?? config.model };
  keyEdited = false;
  render();
});
el.apiKey.addEventListener('input', () => {
  keyEdited = true;
});
el.save.addEventListener('click', () => void onSave());
el.testKey.addEventListener('click', () => void onTestKey());

void init();

async function init(): Promise<void> {
  config = await loadConfig();
  for (const preset of PROVIDER_PRESETS) {
    el.provider.append(new Option(preset.label, preset.id));
  }
  render();
}

function render(): void {
  const preset = getProviderPreset(config.provider);
  el.provider.value = config.provider;

  el.model.replaceChildren();
  for (const model of preset.models) el.model.append(new Option(model.label, model.id));
  const usesPresetModels = preset.models.length > 0;
  el.model.hidden = !usesPresetModels;
  el.modelCustom.hidden = usesPresetModels;
  if (usesPresetModels) el.model.value = config.model;
  else el.modelCustom.value = config.model;

  const storedKey = config.apiKeys[config.provider];
  el.apiKey.value = keyEdited ? el.apiKey.value : '';
  el.apiKey.placeholder = storedKey ? maskApiKey(storedKey) : 'sk-…';
  el.keyHint.textContent = storedKey
    ? 'Une clé est enregistrée. Laissez vide pour la conserver.'
    : 'Stockée localement, jamais envoyée ailleurs qu’au fournisseur choisi.';

  el.customFields.hidden = config.provider !== 'custom';
  el.customEndpoint.value = config.customEndpoint ?? '';
  el.customSegments.checked = config.customSupportsSegments ?? false;
  el.customDiarization.checked = config.customSupportsDiarization ?? false;

  const canDiarize = config.provider === 'custom' ? el.customDiarization.checked : preset.supportsDiarization;
  el.diarize.checked = config.diarize && canDiarize;
  el.diarize.disabled = !canDiarize;
  el.diarizeHint.textContent = canDiarize
    ? 'Les locuteurs sont numérotés chunk par chunk : les numéros ne se suivent pas d’un chunk à l’autre.'
    : `${preset.label} ne fait pas de diarization.`;

  el.downloadAudio.checked = config.downloadAudio;
  el.language.value = config.language ?? '';
  el.testResult.textContent = '';
  showProblems();
}

function collect(): Config {
  const provider = el.provider.value as Provider;
  const preset = getProviderPreset(provider);
  const model = preset.models.length > 0 ? el.model.value : el.modelCustom.value.trim();
  const typedKey = keyEdited ? el.apiKey.value.trim() : '';
  const language = el.language.value.trim();

  return {
    ...config,
    provider,
    model,
    apiKeys: { ...config.apiKeys, ...(typedKey ? { [provider]: typedKey } : {}) },
    customEndpoint: el.customEndpoint.value.trim(),
    customSupportsSegments: el.customSegments.checked,
    customSupportsDiarization: el.customDiarization.checked,
    diarize: el.diarize.checked,
    downloadAudio: el.downloadAudio.checked,
    language: language === '' ? null : language,
  };
}

async function onSave(): Promise<void> {
  const next = collect();
  if (next.provider === 'custom' && !(await ensureHostPermission(next.customEndpoint ?? ''))) {
    el.status.textContent = 'Autorisation réseau refusée pour cet endpoint.';
    return;
  }
  config = next;
  await saveConfig(config);
  keyEdited = false;
  el.status.textContent = 'Enregistré.';
  setTimeout(() => {
    el.status.textContent = '';
  }, 2000);
  render();
}

async function onTestKey(): Promise<void> {
  el.testKey.disabled = true;
  el.testResult.textContent = 'Test en cours…';
  try {
    const provider = createProvider(collect());
    el.testResult.textContent = (await provider.testKey()) ? 'Clé valide.' : 'Clé refusée.';
  } catch (error) {
    el.testResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    el.testKey.disabled = false;
  }
}

/**
 * `<all_urls>` est déclaré en permission *optionnelle* : on ne la demande que
 * pour l'origine de l'endpoint custom, et seulement au moment où l'utilisateur
 * l'enregistre (le clic fournit le geste utilisateur exigé par l'API).
 */
async function ensureHostPermission(endpoint: string): Promise<boolean> {
  let origin: string;
  try {
    origin = `${new URL(endpoint).origin}/*`;
  } catch {
    return true; // Endpoint invalide : validateConfig le signalera.
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

function showProblems(): void {
  const problems = validateConfig(collect());
  el.problems.replaceChildren();
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = problem.message;
    el.problems.append(item);
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`élément #${id} absent de la page d'options`);
  return element as T;
}
