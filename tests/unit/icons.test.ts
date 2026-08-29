import { describe, expect, it } from 'vitest';
import { absoluteIcon, IDLE_ICON, RECORDING_ICON } from '@/shared/icons';

describe('icônes de la barre d outils', () => {
  it('distingue le repos de l enregistrement', () => {
    expect(IDLE_ICON).not.toEqual(RECORDING_ICON);
  });

  /**
   * Le bug : `setIcon` appelé depuis le service worker résout un chemin relatif
   * depuis `background/`, pas depuis la racine. Toute taille laissée relative
   * fait échouer l'appel entier.
   */
  it('absolutise toutes les tailles, pas seulement la première', () => {
    const absolute = absoluteIcon(RECORDING_ICON, (path) => `chrome-extension://abc/${path}`);
    for (const [size, path] of Object.entries(absolute)) {
      expect(path, `taille ${size} restée relative`).toBe(
        `chrome-extension://abc/${RECORDING_ICON[size as keyof typeof RECORDING_ICON]}`,
      );
    }
  });
});
