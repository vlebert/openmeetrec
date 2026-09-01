# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage
[SemVer](https://semver.org/lang/fr/). Les changements en cours s'accumulent dans « Non publié »
jusqu'à la version suivante.

## [Non publié]

### Ajouté

- Rappel d'enregistrement : à l'ouverture d'une page reconnue comme une visioconférence, une
  notification système rappelle de lancer la capture. Rien n'est enregistré automatiquement — le
  départ reste un clic sur l'icône de l'extension, seul geste qui accorde l'autorisation de
  capturer l'onglet.
- Réglages « Meeting reminder » : la liste des URLs de visio (Meet, Teams, Zoom, Jitsi, Whereby,
  Webex…) est pré-remplie et entièrement éditable — une ligne par motif, `*` comme joker. Retirer
  une ligne suffit à ne plus être rappelé sur ce site ; l'option se désactive en entier par une
  case à cocher.

### Modifié

- Nouvelles permissions `tabs` et `notifications`, requises par le rappel ci-dessus : `tabs` parce
  que Chrome retire l'URL des onglets sans elle, `notifications` pour afficher le rappel. Les URLs
  sont comparées aux motifs puis jetées — jamais stockées ni envoyées. Voir
  `docs/permissions-audit.md`.

## [0.3.0] - 2026-08-30

### Ajouté

- Bouton « Retry transcription » dans le popup : après un échec (réseau, clé, overload API), les
  chunks restent en OPFS et le pipeline complet peut être relancé sur la même session, sans
  réenregistrer.
- `npm run test:real-api` : validation manuelle du pipeline contre une vraie API (Mistral/OpenAI),
  hors CI et hors `npm test` — découpe un fichier audio réel en chunks via `ffmpeg`, clé API et
  fichier audio fournis par variables d'environnement, jamais commités.

### Modifié

- Transcription diarizée : les segments consécutifs d'un même speaker sont désormais regroupés en
  un seul paragraphe (un tour de parole), au lieu d'un paragraphe par segment brut renvoyé par
  l'API (~10s). Le regroupement s'arrête à chaque frontière de chunk, car les identifiants de
  speaker ne sont pas appariés d'un chunk à l'autre.

### Corrigé

- `downloadAndWait` restait bloqué indéfiniment quand le fichier téléchargé était minuscule (ex.
  transcription totalement échouée) : le téléchargement se terminait parfois avant que le listener
  `chrome.downloads.onChanged` ne soit posé. L'état courant du téléchargement est maintenant vérifié
  en plus des évènements futurs.

## [0.2.0] - 2026-08-29

Première version numérotée. Tout ce qui précède s'est accumulé sous « Non publié » depuis le
scaffolding : la chaîne complète enregistrement → transcription → export tient debout dans
Chromium, mais n'a encore jamais vu une vraie API ni une vraie visioconférence.

### Ajouté

- PRD et architecture (v0.3), audit des permissions.
- Scaffolding : TypeScript strict, Vite, manifest MV3.
- Chaîne de capture : popup → service worker → offscreen document, mix micro + onglet avec
  ré-injection du son, chunks écrits en OPFS pendant l'enregistrement.
- Transcription : providers Mistral / OpenAI / endpoint personnalisé, pipeline chunks → merge →
  export Markdown, téléchargement en fin de session.
- UI popup (start/stop, durée, niveaux) et page de réglages (fournisseur, clés, options), en anglais.
- Badge « REC » sur l'icône de la barre d'outils pendant l'enregistrement, visible même popup fermé.
- Icône de la barre d'outils au point rouge pendant l'enregistrement, au point gris au repos :
  l'état se lit sans ouvrir le popup, et l'icône ne prétend plus enregistrer en permanence.
- Avertissement et sections « Chunk N » dans le markdown exporté, pour signaler la rupture
  d'identification des locuteurs entre chunks (non résolue en MVP).
- Test d'intégration bout en bout dans Chromium (`npm run test:e2e`).
- Logo : anneau ouvert en trois arcs autour d'un point central (`src/assets/logo.svg`), décliné en
  icônes 16/32/48/128 déclarées dans le manifest.

### Modifié

- Vumètres (micro/onglet) : passage d'une échelle RMS linéaire à une échelle en dB — une voix
  normale restait quasi invisible sur la barre, l'oreille perçoit le volume de façon logarithmique.
- Transcription exportée : le blockquote (`> …`) est retiré, la transcription est en markdown
  simple — il n'apportait rien de plus qu'un formatage superflu.

### Corrigé

- `npm run build` sur un dépôt fraîchement cloné : message d'erreur explicite quand
  `node_modules/` est absent, au lieu d'un stack trace pointant sur le mauvais fichier.
- Placeholder de la clé API dans les réglages : n'affichait `sk-…` pour tous les providers alors
  que seul OpenAI utilise ce format (Mistral, par exemple, ne l'utilise pas).
