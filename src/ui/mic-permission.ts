/**
 * Page d'autorisation du micro.
 *
 * Un offscreen document ne peut pas déclencher de prompt de permission : c'est
 * une page d'extension classique qui doit obtenir l'autorisation une fois, elle
 * vaut ensuite pour l'origine de l'extension (donc pour l'offscreen).
 */

const grant = document.getElementById('grant') as HTMLButtonElement;
const result = document.getElementById('result') as HTMLParagraphElement;

grant.addEventListener('click', () => {
  void (async () => {
    grant.disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      result.textContent = 'Micro autorisé. Vous pouvez fermer cet onglet et relancer l’enregistrement.';
    } catch (error) {
      result.textContent = `Refusé : ${error instanceof Error ? error.message : String(error)}`;
      grant.disabled = false;
    }
  })();
});
