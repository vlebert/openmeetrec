/**
 * Autorisation micro de l'extension, partagée par le popup et la page
 * `mic-permission.html`.
 *
 * L'autorisation vaut pour l'origine `chrome-extension://<id>` : accordée une
 * fois depuis une page d'extension, elle sert ensuite à l'offscreen document,
 * qui ne peut pas afficher la demande lui-même.
 */

/** `unknown` : l'API Permissions n'a pas répondu, on ne présume de rien. */
export type MicPermission = PermissionState | 'unknown';

/**
 * État courant, puis chaque changement (autorisation accordée dans un autre
 * onglet, débloquée dans les réglages de Chrome…) tant que la page est ouverte.
 */
export async function watchMicPermission(onChange: (state: MicPermission) => void): Promise<MicPermission> {
  const status = await queryStatus();
  if (!status) return 'unknown';
  status.addEventListener('change', () => onChange(status.state));
  return status.state;
}

export async function queryMicPermission(): Promise<MicPermission> {
  return (await queryStatus())?.state ?? 'unknown';
}

async function queryStatus(): Promise<PermissionStatus | null> {
  try {
    return await navigator.permissions.query({ name: 'microphone' as PermissionName });
  } catch {
    return null;
  }
}

export function openMicPermissionPage(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('ui/mic-permission.html') });
}

/**
 * Réglages Chrome de l'extension : seul moyen de lever un refus. Une fois le
 * micro bloqué (bouton « Bloquer », ou demande fermée trop de fois), Chrome ne
 * redemande plus et `getUserMedia` échoue aussitôt.
 */
export function openMicSettings(): void {
  const site = encodeURIComponent(new URL(chrome.runtime.getURL('')).origin);
  void chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${site}` });
}
