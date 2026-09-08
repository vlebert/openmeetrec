# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage
[SemVer](https://semver.org/lang/fr/). Les changements en cours s'accumulent dans « Non publié »
jusqu'à la version suivante.

## [Non publié]

### Ajouté

- **Transcription en une seule requête** quand l'enregistrement tient dans les limites du provider.
  L'intérêt n'est pas la vitesse mais la diarization : une seule passe attribue les locuteurs sur
  toute la réunion, là où le découpage les réattribuait à chaque chunk. L'export nomme donc à
  nouveau les locuteurs (`**Speaker 0**`) et annonce `speakers: N`. Mesuré contre l'API Mistral :
  1 h 29 min passent en une requête, transcrites à 99,9 % de leur durée.
- Repli automatique sur le découpage en chunks : soit d'emblée, quand la durée ou la taille
  dépassent les limites du provider — la décision se prend alors avant tout envoi, pour qu'un
  dépassement ne coûte jamais plusieurs minutes d'upload perdues — soit après un échec que le
  découpage peut résoudre. Une clé invalide ou un quota épuisé ne déclenchent pas ce repli : les
  rejouer une fois par chunk ne ferait que brûler des requêtes.

- `npm run test:one-shot` : sonde manuelle qui envoie un enregistrement entier en une seule
  requête, rapporte l'acceptation ou le refus avec le corps d'erreur du provider, et vérifie que
  la transcription couvre bien toute la durée — une API peut accepter un fichier trop long et n'en
  transcrire que le début sans lever d'erreur. `npm run test:real-api` ne lance plus que le chemin
  chunké.
- `src/providers/limits.ts` : limites d'envoi par provider et par modèle, mesurées contre les
  vraies API plutôt que reprises de leur documentation (celle de Mistral se contredit : 60 min sur
  une page, 3 h sur une autre). C'est ce qui décidera, avant tout appel réseau, entre une requête
  unique et du chunking.

### Modifié

- La piste audio continue est désormais **toujours** enregistrée, plus seulement quand l'option
  « télécharger l'audio » est cochée : c'est elle qui rend possible la transcription en une seule
  requête, et elle ne peut pas être reconstituée après coup à partir des chunks. L'option
  utilisateur ne gouverne plus que la sortie du fichier audio.
- Les identifiants de locuteurs des providers sont normalisés à l'affichage : Voxtral renvoie
  `speaker_1`, l'export sortait donc `**speaker_1**` en minuscules au lieu de `**Speaker 1**`.

- Export markdown, transcription issue de plusieurs chunks : les libellés « Speaker N » ne sont plus
  affichés. Ils étaient trompeurs — le provider attribue les identités indépendamment pour chaque
  chunk, donc « Speaker 0 » avant et après une frontière n'est pas la même personne, et un
  avertissement en tête de fichier ne suffit pas à s'en souvenir au milieu du document. La
  diarization ne sert plus qu'à la mise en forme : un paragraphe par tour de parole, préfixé de son
  timestamp `(HH:MM:SS)`. Les anciens intertitres `**Chunk N**` sont remplacés par une règle `---`,
  qui signale la couture sans exposer de notion interne.
- Le frontmatter n'annonce plus `speakers: N` dans ce cas : le compte additionnait des identifiants
  locaux à chaque chunk.
- Quand toute la transcription tient en **une seule requête**, rien ne change : les identités sont
  cohérentes de bout en bout, les libellés `**Speaker N**` et le compte `speakers:` sont conservés.

## [0.6.0] - 2026-09-03

### Ajouté

- Bouton « Reprocess transcription » dans le popup : tant qu'aucun nouvel enregistrement n'a
  démarré, une session déjà terminée avec succès peut être retraitée (les chunks sont encore en
  OPFS), pas seulement une session en échec. Un petit texte « Previous recording available »
  l'indique quand on rouvre le popup sur une session déjà terminée.

## [0.5.0] - 2026-09-03

### Corrigé

- Un chunk sans parole (silence) faisait perdre les timestamps de toute la réunion, avec
  l'avertissement « The model in use does not return timestamps », alors que les autres chunks en
  avaient bien. Confirmé contre l'API Voxtral : un chunk de silence renvoie légitimement
  `segments: []`. Ce chunk ne contribue désormais rien au merge au lieu de dégrader tout le
  document en concaténation brute.

### Modifié

- Chunking par défaut : 3 min / overlap 10 s (au lieu de 5 min / 30 s) — des chunks plus courts,
  plus réactifs à transcrire au fil de l'enregistrement.
- `npm run test:real-api` : détection de la durée de l'audio robuste aux fichiers webm de
  MediaRecorder sans Cues/Duration dans l'en-tête (décodage complet au lieu de lire les métadonnées
  du conteneur). Vérifie aussi que les timestamps renvoyés par le provider tombent bien dans les
  bornes du chunk transcrit, au lieu de supposer silencieusement leur unité et leur référentiel.
  Validé pour de vrai contre Mistral (diarization) et OpenAI.

## [0.4.0] - 2026-09-01

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
