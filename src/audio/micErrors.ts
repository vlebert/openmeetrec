/**
 * Erreurs d'ouverture du micro : cause probable et message pour l'utilisateur.
 * Ce module est PUR : aucune dépendance à `chrome` ni au DOM — il ne lit que le
 * `name` et le `message` des erreurs de `getUserMedia`.
 *
 * Toutes ne se règlent pas en accordant l'autorisation à l'extension : un micro
 * absent, occupé, ou bloqué par le système d'exploitation demande autre chose.
 * Le popup ne propose le bouton d'autorisation que pour `permission`.
 */

export type MicErrorKind = 'permission' | 'system' | 'not-found' | 'busy' | 'other';

export interface MicFailure {
  kind: MicErrorKind;
  message: string;
}

const MIC_ONLY = 'or uncheck “Also record my microphone” to record the meeting audio only.';

export function classifyMicError(error: unknown): MicFailure {
  const { name, message } = describe(error);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      // Chromium : « Permission denied by system » quand c'est l'OS (Réglages
      // Système → Confidentialité sur macOS) qui refuse le micro au navigateur.
      // Aucune autorisation côté extension n'y changerait rien.
      if (/system/i.test(message)) {
        return {
          kind: 'system',
          message:
            'Your operating system blocks microphone access for the browser. On macOS: System Settings → ' +
            `Privacy & Security → Microphone, enable your browser and restart it — ${MIC_ONLY}`,
        };
      }
      return {
        kind: 'permission',
        message: `OpenMeetRec isn't allowed to use the microphone. Allow it, ${MIC_ONLY}`,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'not-found', message: `No microphone found. Plug one in, ${MIC_ONLY}` };
    case 'NotReadableError':
    case 'AbortError':
      // Sous Windows, c'est aussi ce que donne un micro bloqué dans les
      // paramètres de confidentialité du système.
      return {
        kind: 'busy',
        message:
          'The microphone could not be opened: another application may be using it, or the system ' +
          `blocks it. Close that application or check the system privacy settings, ${MIC_ONLY}`,
      };
    default:
      return { kind: 'other', message: `Microphone error: ${message || name || 'unknown error'}` };
  }
}

function describe(error: unknown): { name: string; message: string } {
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    return { name: typeof name === 'string' ? name : '', message: typeof message === 'string' ? message : '' };
  }
  return { name: '', message: String(error) };
}
