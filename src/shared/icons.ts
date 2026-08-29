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
