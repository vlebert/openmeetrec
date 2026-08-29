# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage
[SemVer](https://semver.org/lang/fr/). Tant qu'aucune version n'est publiée, tout s'accumule
dans « Non publié ».

## [Non publié]

### Ajouté

- PRD et architecture (v0.3), audit des permissions.
- Scaffolding : TypeScript strict, Vite, manifest MV3.
- Chaîne de capture : popup → service worker → offscreen document, mix micro + onglet avec
  ré-injection du son, chunks écrits en OPFS pendant l'enregistrement.
- Transcription : providers Mistral / OpenAI / endpoint personnalisé, pipeline chunks → merge →
  export Markdown, téléchargement en fin de session.
- UI popup (start/stop, durée, niveaux) et page de réglages (fournisseur, clés, options), en anglais.
- Badge « REC » sur l'icône de la barre d'outils pendant l'enregistrement, visible même popup fermé.
- Avertissement et sections « Chunk N » dans le markdown exporté, pour signaler la rupture
  d'identification des locuteurs entre chunks (non résolue en MVP).
- Test d'intégration bout en bout dans Chromium (`npm run test:e2e`).

### Modifié

- Vumètres (micro/onglet) : passage d'une échelle RMS linéaire à une échelle en dB — une voix
  normale restait quasi invisible sur la barre, l'oreille perçoit le volume de façon logarithmique.

### Corrigé

- `npm run build` sur un dépôt fraîchement cloné : message d'erreur explicite quand
  `node_modules/` est absent, au lieu d'un stack trace pointant sur le mauvais fichier.
- Placeholder de la clé API dans les réglages : n'affichait `sk-…` pour tous les providers alors
  que seul OpenAI utilise ce format (Mistral, par exemple, ne l'utilise pas).
