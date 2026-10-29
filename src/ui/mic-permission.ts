/**
 * Page d'autorisation du micro.
 *
 * Un offscreen document ne peut pas déclencher de prompt de permission : c'est
 * une page d'extension classique qui doit obtenir l'autorisation une fois, elle
 * vaut ensuite pour l'origine de l'extension (donc pour l'offscreen).
 *
 * Trois états à couvrir, pas seulement le premier : à demander, déjà accordé,
 * et bloqué — où Chrome ne redemande plus, et seuls ses réglages débloquent.
 */

import { classifyMicError } from '@/audio/micErrors';
import { openMicSettings, queryMicPermission, watchMicPermission, type MicPermission } from '@/ui/micAccess';

const grant = document.getElementById('grant') as HTMLButtonElement;
const settings = document.getElementById('settings') as HTMLButtonElement;
const result = document.getElementById('result') as HTMLParagraphElement;

const GRANTED =
  'Microphone allowed. Go back to your meeting tab and click the OpenMeetRec icon to start recording — you can close this tab.';
const BLOCKED =
  'Microphone access is blocked for OpenMeetRec, so Chrome no longer asks. Open Chrome’s settings, set Microphone ' +
  'to “Allow”, then come back here.';

grant.addEventListener('click', () => void request());
settings.addEventListener('click', () => openMicSettings());

void (async () => {
  show(await watchMicPermission(show));
})();

function show(state: MicPermission): void {
  grant.disabled = false;
  if (state === 'granted') {
    result.textContent = GRANTED;
    grant.hidden = true;
    settings.hidden = true;
  } else if (state === 'denied') {
    result.textContent = BLOCKED;
    grant.hidden = true;
    settings.hidden = false;
  } else {
    result.textContent = '';
    grant.hidden = false;
    settings.hidden = true;
  }
}

async function request(): Promise<void> {
  grant.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    show('granted');
  } catch (error) {
    grant.disabled = false;
    const failure = classifyMicError(error);
    if (failure.kind !== 'permission') {
      // Micro absent, occupé ou bloqué par l'OS : l'autorisation n'y peut rien.
      result.textContent = failure.message;
      return;
    }
    const state = await queryMicPermission();
    if (state === 'denied') {
      show('denied');
      return;
    }
    // Demande fermée sans réponse. Au bout de quelques fois, Chrome cesse de
    // la montrer sans pour autant déclarer le micro « bloqué » : d'où le lien
    // vers les réglages, au cas où plus rien ne s'affiche.
    result.textContent =
      'The request was closed without an answer. Click again and choose “Allow” — if no request shows up, ' +
      'allow the microphone in Chrome’s settings.';
    settings.hidden = false;
  }
}
