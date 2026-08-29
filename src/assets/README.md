# Assets

Deux SVG sources, même géométrie, une seule différence : la couleur du point
central. Les PNG sont générés, pas édités à la main.

- `logo.svg` (point rouge) → `icon-rec-*.png` : marque du projet (README, store,
  page des extensions) et icône de la barre d'outils **pendant** l'enregistrement.
- `logo-idle.svg` (point gris) → `icon-idle-*.png` : icône de la barre d'outils au
  repos, celle que déclare `action.default_icon`.

Le service worker bascule de l'une à l'autre (`src/shared/icons.ts`).

Après toute modification d'un SVG, régénérer les quatre tailles déclarées dans le
manifest (`rsvg-convert` vient du paquet système `librsvg2-bin`) :

```bash
for s in 16 32 48 128; do
  rsvg-convert -w $s -h $s src/assets/logo.svg -o src/assets/icon-rec-$s.png
  rsvg-convert -w $s -h $s src/assets/logo-idle.svg -o src/assets/icon-idle-$s.png
done
```

Les PNG sont versionnés pour qu'un `npm ci && npm run build` sur une machine sans
rasteriseur produise quand même une extension complète.
