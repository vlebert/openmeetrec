/**
 * Les deux jeux d'icônes de la barre d'outils, par taille.
 *
 * Le point du logo est rouge pendant l'enregistrement, gris le reste du temps :
 * c'est l'icône elle-même qui porte l'état, le badge REC ne fait que le redire
 * en toutes lettres (un état signalé par la seule couleur ne se voit pas de tout
 * le monde).
 *
 * Module sans `chrome` : les chemins sont vérifiés en test unitaire contre les
 * fichiers réellement présents dans `src/assets/`.
 */

export type IconPaths = Record<'16' | '32' | '48' | '128', string>;

const paths = (variant: 'idle' | 'rec'): IconPaths => ({
  '16': `assets/icon-${variant}-16.png`,
  '32': `assets/icon-${variant}-32.png`,
  '48': `assets/icon-${variant}-48.png`,
  '128': `assets/icon-${variant}-128.png`,
});

export const IDLE_ICON = paths('idle');
export const RECORDING_ICON = paths('rec');

/**
 * Absolutise un jeu d'icônes avant de le passer à `chrome.action.setIcon`.
 *
 * Les chemins ci-dessus sont ceux du manifest, donc relatifs à la racine de
 * l'extension. Mais `setIcon` appelé depuis le service worker résout un chemin
 * relatif par rapport au *script du worker* : `assets/icon-rec-16.png` était
 * cherché dans `background/assets/`, et l'appel échouait sur un « Failed to set
 * icon: Failed to fetch » — l'icône ne changeait jamais, seul le badge bougeait.
 *
 * `toUrl` est injecté (`chrome.runtime.getURL`) pour que ce module reste
 * testable sans navigateur.
 */
export function absoluteIcon(icon: IconPaths, toUrl: (path: string) => string): IconPaths {
  return {
    '16': toUrl(icon['16']),
    '32': toUrl(icon['32']),
    '48': toUrl(icon['48']),
    '128': toUrl(icon['128']),
  };
}
