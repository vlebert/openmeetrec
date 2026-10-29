/**
 * Choix du micro : liste affichée dans le popup, nom du micro réellement ouvert.
 * Ce module est PUR : aucune dépendance à `chrome` ni au DOM — il ne manipule
 * que la forme de `MediaDeviceInfo`.
 *
 * Chromium expose deux pseudo-périphériques, `default` (le micro par défaut du
 * système, que Chrome suit) et `communications` (Windows). Ils doublonnent un
 * vrai micro : on n'en garde que `default`, présenté comme « System default »
 * avec le nom du micro qu'il désigne, retrouvé par `groupId` plutôt qu'en
 * analysant son libellé (« Default - … », traduit selon la langue de Chrome).
 */

export interface DeviceLike {
  deviceId: string;
  groupId: string;
  kind: string;
  label: string;
}

/** `null` = micro par défaut du système : aucune contrainte `deviceId`. */
export type MicChoice = string | null;

export interface MicOption {
  /** `''` pour le défaut système (valeur d'un `<option>`). */
  value: string;
  label: string;
}

/**
 * Traitements appliqués au micro, à l'enregistrement comme dans l'aperçu du
 * popup : le niveau affiché avant de lancer doit être celui qui sera enregistré.
 */
export const MIC_PROCESSING = { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as const;

/** Contraintes `getUserMedia` : le micro choisi, ou le défaut système. */
export function micConstraints(deviceId: MicChoice): { audio: { [key: string]: unknown } } {
  return { audio: deviceId === null ? { ...MIC_PROCESSING } : { ...MIC_PROCESSING, deviceId: { exact: deviceId } } };
}

const DEFAULT_ID = 'default';
const PSEUDO_IDS = new Set([DEFAULT_ID, 'communications']);

/**
 * Options du sélecteur. Sans autorisation micro, Chrome renvoie des libellés
 * vides : on numérote alors les micros plutôt que d'afficher des lignes blanches.
 */
export function micOptions(devices: readonly DeviceLike[]): MicOption[] {
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const defaultName = nameOfDefault(inputs);
  const options: MicOption[] = [
    { value: '', label: defaultName ? `System default (${defaultName})` : 'System default' },
  ];
  inputs
    .filter((device) => !PSEUDO_IDS.has(device.deviceId) && device.deviceId !== '')
    .forEach((device, index) => {
      options.push({ value: device.deviceId, label: device.label || `Microphone ${index + 1}` });
    });
  return options;
}

/**
 * Choix effectif : le micro mémorisé s'il est encore branché, sinon le défaut
 * système. `missing` signale qu'on a dû se replier.
 */
export function resolveMicChoice(
  preferred: MicChoice,
  devices: readonly DeviceLike[],
): { choice: MicChoice; missing: boolean } {
  if (preferred === null) return { choice: null, missing: false };
  const present = devices.some((device) => device.kind === 'audioinput' && device.deviceId === preferred);
  return present ? { choice: preferred, missing: false } : { choice: null, missing: true };
}

/**
 * Nom lisible du micro réellement ouvert, à partir des réglages de la piste.
 * Le libellé de la piste vaut « Default - … » quand on a ouvert le défaut ;
 * le `groupId` permet de retrouver le vrai périphérique.
 */
export function micDisplayName(
  track: { deviceId?: string | undefined; groupId?: string | undefined; label: string },
  devices: readonly DeviceLike[],
): string {
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  if (track.deviceId && !PSEUDO_IDS.has(track.deviceId)) {
    const exact = inputs.find((device) => device.deviceId === track.deviceId);
    if (exact?.label) return exact.label;
  }
  if (track.groupId) {
    const real = inputs.find(
      (device) => device.groupId === track.groupId && !PSEUDO_IDS.has(device.deviceId) && device.label,
    );
    if (real) return real.label;
  }
  return track.label || 'Unknown microphone';
}

function nameOfDefault(inputs: readonly DeviceLike[]): string {
  const fallback = inputs.find((device) => device.deviceId === DEFAULT_ID);
  if (!fallback) return '';
  const real = inputs.find(
    (device) => device.groupId === fallback.groupId && !PSEUDO_IDS.has(device.deviceId) && device.label,
  );
  return real?.label ?? fallback.label;
}
